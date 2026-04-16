import { db, auth } from '../firebase';
import { 
  collection, 
  doc, 
  writeBatch, 
  increment, 
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  Timestamp
} from 'firebase/firestore';

/**
 * Step 1: Database Schema Expansion (NoSQL)
 * 
 * New Collection: `collectorLogs`
 * Document Structure:
 * {
 *   logId: string (auto-generated)
 *   collectorId: string (indexed)
 *   userId: string (indexed)
 *   bagType: 'WET' | 'DRY' | 'E_WASTE' | 'HAZARDOUS' | 'SANITARY' | 'GLASS_METAL'
 *   grade: 'PERFECT' | 'MIXED' | 'REJECT'
 *   timestamp: number (epoch ms, indexed for daily queries)
 * }
 */

export type BagType = 'WET' | 'DRY' | 'E_WASTE' | 'HAZARDOUS' | 'SANITARY' | 'GLASS_METAL';

export const decodeBagQR = (qrPayload: string) => {
  // Assuming a lightweight, fast format: "USERID_BAGTYPE_TIMESTAMP_HASH"
  // e.g., "USR992_WET_1711080000_ABC"
  const parts = qrPayload.split('_');
  if (parts.length < 2) throw new Error("Invalid QR Payload");
  
  return {
    userId: parts[0],
    bagType: parts[1] as BagType,
  };
};

/**
 * Error Handling Spec for Firestore Operations
 */
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * processWasteGrade(userId, bagType, grade, collectorId)
 * The master function. Executes when the collector taps 🟢 PERFECT, 🟡 MIXED, or 🔴 REJECT.
 */
export const processWasteGrade = async (
  userId: string, 
  bagType: BagType, 
  grade: 'PERFECT' | 'MIXED' | 'REJECT', 
  collectorId: string
) => {
  let tokenReward = 0;
  if (grade === 'PERFECT') tokenReward = 10;
  else if (grade === 'MIXED') tokenReward = 5;
  else if (grade === 'REJECT') tokenReward = 0;

  const batch = writeBatch(db);
  const userRef = doc(db, 'users', userId);
  const txRef = doc(collection(db, 'transactions'));
  const logRef = doc(collection(db, 'collectorLogs'));

  try {
    // 1. Check if user exists, if not create them (simplified for demo)
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      batch.set(userRef, {
        uid: userId,
        displayName: `Citizen ${userId.slice(-4)}`,
        swacchCoinBalance: tokenReward,
        flaggedForEducation: grade === 'REJECT',
        role: 'user'
      });
    } else {
      // 2. Update User Balance & Flags
      batch.update(userRef, { 
        swacchCoinBalance: increment(tokenReward),
        flaggedForEducation: grade === 'REJECT'
      });
    }

    // 3. Write Transaction Ledger
    batch.set(txRef, { 
      userId, 
      amount: tokenReward, 
      type: 'WASTE_DEPOSIT', 
      timestamp: Date.now() 
    });

    // 4. Write Collector Log
    batch.set(logRef, { 
      collectorId, 
      userId, 
      bagType, 
      grade, 
      timestamp: Date.now() 
    });

    await batch.commit(); // Atomic, fast write
    return { success: true, tokenReward, grade };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
    return { success: false, error };
  }
};

/**
 * getCollectorShiftStats(collectorId)
 * Fetches a rapid count of total bags scanned and perfectly segregated bags.
 */
export const getCollectorShiftStats = async (collectorId: string) => {
  try {
    const logsRef = collection(db, 'collectorLogs');
    const q = query(logsRef, where('collectorId', '==', collectorId));
    const querySnapshot = await getDocs(q);
    
    let totalScanned = 0;
    let perfectBags = 0;

    querySnapshot.forEach((doc) => {
      totalScanned++;
      if (doc.data().grade === 'PERFECT') {
        perfectBags++;
      }
    });

    return {
      totalScanned,
      perfectBags
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'collectorLogs');
    return { totalScanned: 0, perfectBags: 0 };
  }
};

/**
 * getCollectorLogs(collectorId)
 * Fetches the full scan history for a collector.
 */
export const getCollectorLogs = async (collectorId: string) => {
  try {
    const logsRef = collection(db, 'collectorLogs');
    const q = query(
      logsRef, 
      where('collectorId', '==', collectorId)
    );
    const querySnapshot = await getDocs(q);
    
    const logs: any[] = [];
    querySnapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });

    // Sort client-side to avoid composite index requirement for now
    return logs.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'collectorLogs');
    return [];
  }
};
