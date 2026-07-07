export interface Department {
  id: string; // The document ID, e.g., 'service', 'insurance', 'bodyshop'
  name: string;
  code: string;
  isActive: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  departmentId: string;
  department: string; // compatibility
  isActive: boolean;
  canDeleteSession: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export type PlateRecognitionClassification =
  | "accepted"
  | "review"
  | "not_detected";

export interface AmbiguousCharacter {
  position: number;
  observed: string;
  alternatives: string[];
}

export interface PlateRecognitionResult {
  plateFound: boolean;
  plateDisplay: string | null;
  plateNormalized: string | null;
  confidence: number;
  needsReview: boolean;
  ambiguousCharacters: AmbiguousCharacter[];
  reason: string;
  classification: PlateRecognitionClassification;
  latencyMs?: number;
  retryCount?: number;
}

export type PlateRecognitionUiStatus =
  | "idle"
  | "processing"
  | "accepted"
  | "verified"
  | "review"
  | "conflict"
  | "not_detected"
  | "technical_error";

