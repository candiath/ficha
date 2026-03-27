export interface ClinicalAlert {
  id: string;
  patientId: string;
  patientName: string;
  type: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface AlertStats {
  unread: number;
  followUp: number;
  payment: number;
  noShow: number;
}
