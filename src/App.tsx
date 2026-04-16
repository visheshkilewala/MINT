import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Camera, CheckCircle2, AlertTriangle, XCircle, Activity, ScanLine, History, MapPin, LogIn, LogOut, Settings, User as UserIcon, Shield, Info, ChevronRight, FileDown, Download, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { decodeBagQR, processWasteGrade, getCollectorShiftStats, getCollectorLogs, BagType } from './services/wasteService';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';

// Error Boundary Component
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
          <h1 className="text-2xl font-black text-white mb-2">Something went wrong</h1>
          <p className="text-zinc-400 mb-6 max-w-xs">{this.state.error?.message || "An unexpected error occurred."}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-zinc-800 text-white rounded-xl font-bold border border-zinc-700"
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

type BagGrade = 'PERFECT' | 'MIXED' | 'REJECT';

interface ScannedBag {
  userId: string;
  bagType: BagType;
  rawPayload: string;
}

const BAG_TYPES: BagType[] = ['WET', 'DRY', 'E_WASTE', 'HAZARDOUS', 'SANITARY', 'GLASS_METAL'];

const getBagDisplayInfo = (type?: BagType) => {
  switch (type) {
    case 'WET': return { label: 'WET', colorClass: 'bg-emerald-600 text-white border-emerald-400', activeRing: 'ring-emerald-400' };
    case 'DRY': return { label: 'DRY', colorClass: 'bg-blue-600 text-white border-blue-400', activeRing: 'ring-blue-400' };
    case 'E_WASTE': return { label: 'E-WASTE', colorClass: 'bg-purple-600 text-white border-purple-400', activeRing: 'ring-purple-400' };
    case 'HAZARDOUS': return { label: 'HAZARD', colorClass: 'bg-rose-600 text-white border-rose-400', activeRing: 'ring-rose-400' };
    case 'SANITARY': return { label: 'SANITARY', colorClass: 'bg-pink-600 text-white border-pink-400', activeRing: 'ring-pink-400' };
    case 'GLASS_METAL': return { label: 'GLASS/METAL', colorClass: 'bg-amber-600 text-white border-amber-400', activeRing: 'ring-amber-400' };
    default: return { label: 'UNKNOWN', colorClass: 'bg-zinc-600 text-white border-zinc-400', activeRing: 'ring-zinc-400' };
  }
};

interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export default function App() {
  return (
    <ErrorBoundary>
      <CollectorApp />
    </ErrorBoundary>
  );
}

function CollectorApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'scanner' | 'settings' | 'history'>('scanner');
  const [stats, setStats] = useState({ totalScanned: 0, perfectBags: 0 });
  const [history, setHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [scannedBag, setScannedBag] = useState<ScannedBag | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [showFlash, setShowFlash] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<BagType>>(new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdCounter = useRef(0);

  // Derived collector ID
  const COLLECTOR_ID = user?.uid || 'GUEST_COLLECTOR';

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthReady && user) {
      // Load initial stats
      getCollectorShiftStats(COLLECTOR_ID).then(setStats);
    }
  }, [isAuthReady, user, COLLECTOR_ID]);

  useEffect(() => {
    if (view === 'history' && user) {
      setIsLoadingHistory(true);
      getCollectorLogs(COLLECTOR_ID).then(logs => {
        setHistory(logs);
        setIsLoadingHistory(false);
      });
    }
  }, [view, user, COLLECTOR_ID]);

  const exportHistory = () => {
    if (history.length === 0) {
      addToast("No history to export", "info");
      return;
    }

    const headers = ["ID", "User ID", "Bag Type", "Grade", "Timestamp"];
    const rows = history.map(log => [
      log.id,
      log.userId,
      log.bagType,
      log.grade,
      new Date(log.timestamp).toLocaleString()
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `scan_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast("Report exported successfully", "success");
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      addToast("Login failed", "error");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setStats({ totalScanned: 0, perfectBags: 0 });
    } catch (error) {
      addToast("Logout failed", "error");
    }
  };

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const toggleCategory = (type: BagType) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(type)) {
      newSelected.delete(type);
    } else {
      newSelected.add(type);
    }
    setSelectedCategories(newSelected);
  };

  // Step 3: Updated simulateScan with Photo Flash Effect
  const simulateScan = () => {
    // 1. Trigger Shutter/Flash Effect
    setShowFlash(true);
    
    // Play mock shutter sound (visual only)
    setTimeout(() => {
      setShowFlash(false);
      setIsScanning(false);
      
      // Mock QR payload (format: USERID_BAGTYPE_TIMESTAMP_HASH)
      const mockPayload = `USR${Math.floor(Math.random() * 9000) + 1000}_WET_${Date.now()}_HASH`;
      try {
        const decoded = decodeBagQR(mockPayload);
        setScannedBag({ ...decoded, rawPayload: mockPayload });
        // Pre-select the one from QR if applicable, or start fresh
        setSelectedCategories(new Set([decoded.bagType]));
      } catch (err) {
        addToast("Invalid QR Code", "error");
        setIsScanning(true);
      }
    }, 150); // Quick flash duration
  };

  // Step 3: Frontend Integration Strategy - Optimistic UI Update
  const handleGrade = async (grade: BagGrade) => {
    if (!scannedBag || selectedCategories.size === 0) {
      addToast("Select at least one category", "info");
      return;
    }

    const userId = scannedBag.userId;
    const categories = Array.from(selectedCategories);
    
    // 1. OPTIMISTIC UPDATE
    setStats(prev => ({
      totalScanned: prev.totalScanned + categories.length,
      perfectBags: prev.perfectBags + (grade === 'PERFECT' ? categories.length : 0)
    }));
    
    // 2. INSTANT RESET
    setScannedBag(null);
    setSelectedCategories(new Set());
    setIsScanning(true);
    addToast(`${categories.length} bags collected: ${grade}`, 'success');

    // 3. BACKGROUND PROCESSING
    try {
      // In production, we'd send the array of categories
      await Promise.all(categories.map((cat: BagType) => 
        processWasteGrade(userId, cat, grade, COLLECTOR_ID)
      ));
      console.log(`Successfully processed ${categories.length} items for ${userId}`);
      
      // Refresh history if we're in history view or to have it ready
      if (user) {
        const logs = await getCollectorLogs(COLLECTOR_ID);
        setHistory(logs);
      }
    } catch (error) {
      // 4. ROLLBACK ON FAILURE
      setStats(prev => ({
        totalScanned: prev.totalScanned - categories.length,
        perfectBags: prev.perfectBags - (grade === 'PERFECT' ? categories.length : 0)
      }));
      addToast(`Sync failed for ${userId}.`, 'error');
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mb-8 border border-emerald-500/20">
          <ScanLine className="w-12 h-12 text-emerald-500" />
        </div>
        <h1 className="text-4xl font-black text-white mb-2 tracking-tighter">SWACCHCOIN</h1>
        <p className="text-zinc-500 mb-12 font-medium tracking-tight">Collector Terminal v2.4</p>
        
        <button 
          onClick={handleLogin}
          className="w-full max-w-xs bg-emerald-600 hover:bg-emerald-500 text-white font-black py-5 rounded-3xl flex items-center justify-center gap-3 shadow-2xl border-b-8 border-emerald-800 transition-all active:translate-y-1 active:border-b-0"
        >
          <LogIn className="w-6 h-6" />
          SIGN IN TO START SHIFT
        </button>
        
        <p className="mt-12 text-[10px] text-zinc-700 font-bold uppercase tracking-[0.3em]">Authorized Personnel Only</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 flex flex-col overflow-hidden">
      {/* Shutter Flash Overlay */}
      <AnimatePresence>
        {showFlash && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white z-[100] pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Top HUD - Shift Stats */}
      <header className="bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setView('scanner')}
            className="flex items-center gap-3 text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-100 tracking-tight">SHIFT ACTIVE</h1>
              <p className="text-xs text-zinc-500 font-mono">{COLLECTOR_ID.slice(0, 8)}</p>
            </div>
          </button>
        </div>
        
        <div className="flex gap-4 items-center">
          <div className="hidden sm:flex gap-4 mr-2">
            <div className="text-right">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Scanned</p>
              <p className="text-xl font-mono font-bold text-zinc-100">{stats.totalScanned}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Perfect</p>
              <p className="text-xl font-mono font-bold text-emerald-400">{stats.perfectBags}</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => setView('history')}
              className={`p-2 border rounded-xl transition-all ${view === 'history' ? 'bg-emerald-500 border-emerald-400 text-zinc-950' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
            >
              <History className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setView(view === 'settings' ? 'scanner' : 'settings')}
              className={`p-2 border rounded-xl transition-all ${view === 'settings' ? 'bg-emerald-500 border-emerald-400 text-zinc-950' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24 relative">
        <AnimatePresence mode="wait">
          {view === 'scanner' ? (
            <motion.div
              key="scanner"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full flex flex-col"
            >
              {/* Camera Viewfinder (Simulated) */}
              <AnimatePresence mode="wait">
                {isScanning ? (
                  <motion.div 
                    key="scanner-view"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-[400px]"
                  >
                    {/* Simulated Camera Feed Background */}
                    <div className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm z-0" />
                    
                    <div className="relative z-10 w-full max-w-sm aspect-square border-2 border-dashed border-zinc-700 rounded-3xl flex flex-col items-center justify-center bg-zinc-900/80 shadow-2xl">
                      <ScanLine className="w-16 h-16 text-zinc-500 mb-4 animate-pulse" />
                      <p className="text-sm font-medium text-zinc-400 text-center px-8">
                        Point camera at waste bag QR code
                      </p>
                      
                      {/* Mock Scan Button for Demo */}
                      <button 
                        onClick={simulateScan}
                        className="mt-8 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-full font-bold text-sm transition-colors border border-zinc-700 shadow-lg flex items-center gap-2"
                      >
                        <Camera className="w-4 h-4" />
                        Simulate Scan
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="grading"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex-1 flex flex-col p-4 z-10 overflow-y-auto"
                  >
                    {/* Scanned User Info - High Contrast */}
                    <div className="bg-zinc-800 rounded-2xl p-4 border-2 border-zinc-700 shadow-2xl mb-6">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">USER ID</p>
                          <p className="text-2xl font-mono font-black text-white">{scannedBag?.userId}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">LOCATION</p>
                          <p className="text-sm font-bold text-emerald-400">SECTOR 4 • B</p>
                        </div>
                      </div>
                    </div>

                    {/* Multi-Category Selection Grid - Chunky & High Contrast */}
                    <div className="mb-8">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-4">SELECT CATEGORIES FOUND</p>
                      <div className="grid grid-cols-2 gap-4">
                        {BAG_TYPES.map(type => {
                          const info = getBagDisplayInfo(type);
                          const isSelected = selectedCategories.has(type);
                          return (
                            <button
                              key={type}
                              onClick={() => toggleCategory(type)}
                              className={`h-28 rounded-3xl border-4 transition-all flex flex-col items-center justify-center gap-2 text-center shadow-2xl ${
                                isSelected 
                                  ? `${info.colorClass} scale-[1.05] ring-8 ring-white/10 z-10` 
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-600'
                              }`}
                            >
                              <span className={`text-xl font-black tracking-tighter ${isSelected ? 'text-white' : 'text-zinc-600'}`}>
                                {info.label}
                              </span>
                              {isSelected && <CheckCircle2 className="w-8 h-8 text-white animate-in zoom-in duration-200" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Grading Actions - Massive buttons for quick tapping */}
                    <div className="mt-auto pt-4 flex flex-col gap-4">
                      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em] text-center mb-1">GRADE SEGREGATION</p>
                      
                      <div className="grid grid-cols-3 gap-3">
                        <button 
                          onClick={() => handleGrade('PERFECT')}
                          className="h-32 bg-emerald-600 hover:bg-emerald-500 rounded-3xl border-b-8 border-emerald-800 flex flex-col items-center justify-center gap-2 transition-all active:translate-y-1 active:border-b-0"
                        >
                          <CheckCircle2 className="w-8 h-8 text-white" />
                          <span className="text-xs font-black text-white">PERFECT</span>
                        </button>
                        
                        <button 
                          onClick={() => handleGrade('MIXED')}
                          className="h-32 bg-amber-600 hover:bg-amber-500 rounded-3xl border-b-8 border-amber-800 flex flex-col items-center justify-center gap-2 transition-all active:translate-y-1 active:border-b-0"
                        >
                          <AlertTriangle className="w-8 h-8 text-white" />
                          <span className="text-xs font-black text-white">MIXED</span>
                        </button>
                        
                        <button 
                          onClick={() => handleGrade('REJECT')}
                          className="h-32 bg-rose-600 hover:bg-rose-500 rounded-3xl border-b-8 border-rose-800 flex flex-col items-center justify-center gap-2 transition-all active:translate-y-1 active:border-b-0"
                        >
                          <XCircle className="w-8 h-8 text-white" />
                          <span className="text-xs font-black text-white">REJECT</span>
                        </button>
                      </div>
                      
                      <button 
                        onClick={() => {
                          setIsScanning(true);
                          setScannedBag(null);
                          setSelectedCategories(new Set());
                        }}
                        className="mt-4 py-4 text-zinc-500 font-bold uppercase tracking-widest text-xs hover:text-zinc-300 transition-colors"
                      >
                        Cancel Scan
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : view === 'history' ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-6 max-w-4xl mx-auto w-full"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">Scan History</h2>
                  <p className="text-zinc-500 font-medium">Review your collection logs</p>
                </div>
                <button 
                  onClick={exportHistory}
                  disabled={history.length === 0 || isLoadingHistory}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl font-bold text-sm transition-all shadow-lg"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>

              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
                  <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">Loading Logs...</p>
                </div>
              ) : history.length === 0 ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-12 text-center">
                  <History className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">No scans recorded yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((log) => (
                    <div 
                      key={log.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border-2 ${
                          log.grade === 'PERFECT' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                          log.grade === 'MIXED' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                          'bg-rose-500/10 border-rose-500/20 text-rose-500'
                        }`}>
                          {log.grade === 'PERFECT' ? <CheckCircle2 className="w-6 h-6" /> :
                           log.grade === 'MIXED' ? <AlertTriangle className="w-6 h-6" /> :
                           <XCircle className="w-6 h-6" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">{log.userId}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {(() => {
                              const info = getBagDisplayInfo(log.bagType);
                              return (
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border shadow-sm ${info.colorClass}`}>
                                  {info.label}
                                </span>
                              );
                            })()}
                            <span className="text-[10px] font-medium text-zinc-600">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-black ${
                          log.grade === 'PERFECT' ? 'text-emerald-500' :
                          log.grade === 'MIXED' ? 'text-amber-500' :
                          'text-rose-500'
                        }`}>
                          {log.grade}
                        </p>
                        <p className="text-[10px] font-medium text-zinc-600 mt-1">
                          {new Date(log.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-6 max-w-2xl mx-auto w-full"
            >
              <div className="mb-8 flex items-center gap-4">
                <div className="relative">
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt={user.displayName || 'Collector'} 
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-500/50"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-zinc-800 flex items-center justify-center border-2 border-zinc-700">
                      <UserIcon className="w-10 h-10 text-zinc-500" />
                    </div>
                  )}
                  <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg">
                    <Shield className="w-4 h-4 text-zinc-950" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">{user.displayName || 'Collector'}</h2>
                  <p className="text-zinc-500 font-medium">{user.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Total Scanned</p>
                  <p className="text-3xl font-mono font-black text-white">{stats.totalScanned}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl">
                  <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Perfect Bags</p>
                  <p className="text-3xl font-mono font-black text-emerald-400">{stats.perfectBags}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] px-2">Shift Details</h3>
                
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="p-4 flex items-center justify-between border-b border-zinc-800/50">
                    <div className="flex items-center gap-3">
                      <ScanLine className="w-5 h-5 text-zinc-500" />
                      <span className="text-sm font-bold text-zinc-300">Shift ID</span>
                    </div>
                    <span className="text-xs font-mono text-zinc-500">{COLLECTOR_ID}</span>
                  </div>
                  <div className="p-4 flex items-center justify-between border-b border-zinc-800/50">
                    <div className="flex items-center gap-3">
                      <MapPin className="w-5 h-5 text-zinc-500" />
                      <span className="text-sm font-bold text-zinc-300">Current Zone</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-500">ZONE-07 (DOWNTOWN)</span>
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <History className="w-5 h-5 text-zinc-500" />
                      <span className="text-sm font-bold text-zinc-300">Shift Started</span>
                    </div>
                    <span className="text-xs font-bold text-zinc-500">22 Mar 2026, 05:28</span>
                  </div>
                </div>

                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] px-2 pt-4">System</h3>
                
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="p-4 flex items-center justify-between border-b border-zinc-800/50">
                    <div className="flex items-center gap-3">
                      <Info className="w-5 h-5 text-zinc-500" />
                      <span className="text-sm font-bold text-zinc-300">App Version</span>
                    </div>
                    <span className="text-xs font-bold text-zinc-500">v2.4.0-stable</span>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-full p-4 flex items-center justify-between text-rose-500 hover:bg-rose-500/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <LogOut className="w-5 h-5" />
                      <span className="text-sm font-bold">End Shift & Logout</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-rose-500/30" />
                  </button>
                </div>
              </div>

              <div className="mt-12 text-center">
                <p className="text-[10px] text-zinc-800 font-bold uppercase tracking-[0.4em]">Proprietary Hardware Interface</p>
                <p className="text-[10px] text-zinc-800 font-bold uppercase tracking-[0.4em] mt-1">SwacchCoin Protocol v4.2</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Toast Notifications */}
      <div className="fixed bottom-6 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={`px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 max-w-sm w-full pointer-events-auto ${
                toast.type === 'success' ? 'bg-emerald-900/90 border border-emerald-500/30 text-emerald-100' :
                toast.type === 'error' ? 'bg-rose-900/90 border border-rose-500/30 text-rose-100' :
                'bg-zinc-800/90 border border-zinc-700 text-zinc-100'
              }`}
            >
              {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {toast.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
              <p className="text-sm font-medium">{toast.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
