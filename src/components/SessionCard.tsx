import React from 'react';
import { format } from 'date-fns';
import { motion } from 'motion/react';
import { useAuth } from '@/src/context/AuthContext';
import ResolvedImage from './ResolvedImage';
import { resolveSessionDepartmentId } from '@/src/lib/departmentResolver';

interface SessionCardProps {
  key?: React.Key;
  session: {
    id: string;
    plateNumber: string;
    roNumber: string;
    createdAt: any;
    imageCount: number;
    thumbnailUrl: string;
    note?: string;
    imageUrls?: string[];
    storagePaths?: string[];
    department?: string;
    departmentId?: string;
    creatorDepartment?: string;
    createdByDepartment?: string;
    status?: string;
  };
  deptNames?: Record<string, string>;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function SessionCard({ session, deptNames, onView, onEdit, onDelete }: SessionCardProps) {
  const { user } = useAuth();
  
  const userDept = user?.departmentId || user?.department;
  const sessDept = resolveSessionDepartmentId(session);
  
  const canDelete = user?.role === 'admin' || (
    user?.canDeleteSession === true && 
    userDept && sessDept && userDept === sessDept
  );

  const isUploading = session.status === 'uploading' || 
                      !session.imageCount || 
                      session.imageCount === 0 || 
                      !session.imageUrls || 
                      session.imageUrls.length === 0 || 
                      !session.thumbnailUrl;

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl p-3 sm:p-4 border border-gray-100/80 shadow-sm flex flex-col gap-2.5 sm:gap-3 group"
    >
      <div className="relative h-28 sm:h-36 rounded-2xl overflow-hidden bg-gray-100 shadow-inner shrink-0">
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md text-white text-[11px] px-2 py-0.5 rounded-full font-extrabold z-10 shadow-sm">
          {session.imageCount || 0} Ảnh
        </div>
        <ResolvedImage 
          url={session.thumbnailUrl || ''} 
          storagePath={session.storagePaths?.[0] || ''}
          alt={session.plateNumber || 'Xe chưa hoàn tất'} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
        />
      </div>
      
      <div className="flex flex-col gap-1 w-full min-w-0">
        <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
          <h3 className="text-base font-black text-toyota-navy leading-tight tracking-tight truncate flex-1" title={session.plateNumber || 'Chưa có biển số'}>
            {session.plateNumber || 'CHƯA CÓ BIỂN SỐ'}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {isUploading && (
              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-lg border bg-amber-50 text-amber-600 border-amber-200 whitespace-nowrap animate-pulse">
                Chưa hoàn tất
              </span>
            )}
            {!sessDept ? (
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border bg-gray-50 text-gray-500 border-gray-200 whitespace-nowrap">
                Mới
              </span>
            ) : (
              <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border whitespace-nowrap ${
                sessDept === 'baohiem' || sessDept === 'insurance'
                  ? 'bg-purple-50 text-purple-600 border-purple-100'
                  : sessDept === 'service'
                  ? 'bg-blue-50 text-blue-600 border-blue-100'
                  : 'bg-teal-50 text-teal-600 border-teal-100'
              }`}>
                {deptNames?.[sessDept] || (sessDept === 'baohiem' || sessDept === 'insurance' ? 'Bảo hiểm' : sessDept === 'service' ? 'Dịch vụ' : sessDept)}
              </span>
            )}
          </div>
        </div>

        {isUploading && (
          <p className="text-[10px] text-amber-600 bg-amber-50/50 p-2 rounded-xl border border-amber-100 leading-normal mt-1 mb-1 font-bold">
            ⚠️ Phiên này đã được tạo nhưng ảnh có thể chưa tải xong. Vui lòng kiểm tra kết nối hoặc thử lại.
          </p>
        )}

        <div className="text-[11px] text-gray-400 font-bold leading-normal mt-0.5 space-y-0.5">
          <div className="flex items-center gap-1.5 text-gray-500">
            <span className="text-gray-700">RO: {session.roNumber || 'Chưa có'}</span>
          </div>
          <div className="text-gray-400 font-medium">
            {(() => {
              const potentialDates = [
                (session as any).capturedAt,
                session.createdAt,
                (session as any).uploadedAt,
                (session as any).createdAtText,
              ];
              for (const dt of potentialDates) {
                if (!dt) continue;
                try {
                  let dateObj: Date;
                  if (typeof dt === 'number') {
                    dateObj = new Date(dt);
                  } else if (dt.seconds !== undefined && dt.nanoseconds !== undefined) {
                    dateObj = new Date(dt.seconds * 1000);
                  } else if (typeof dt.toDate === 'function') {
                    dateObj = dt.toDate();
                  } else {
                    dateObj = new Date(dt);
                  }
                  if (!isNaN(dateObj.getTime())) {
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    return `${pad(dateObj.getDate())}/${pad(dateObj.getMonth() + 1)} • ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                  }
                } catch (e) {}
              }
              return 'N/A';
            })()}
          </div>
        </div>
      </div>

      {session.note && (
        <p className="text-[11px] text-gray-400 italic truncate px-0.5 flex items-center gap-1 mt-0.5" title={session.note}>
          <span className="shrink-0 text-[10px] not-italic">💬</span>
          <span className="truncate">{session.note}</span>
        </p>
      )}

      <div className={`grid ${canDelete ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 mt-auto pt-2 border-t border-gray-50/80`}>
        <button 
          type="button"
          onClick={() => onView(session.id)}
          className="text-[11px] font-black uppercase py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-toyota-navy border border-gray-100/50 transition-colors active:scale-95 text-center flex items-center justify-center cursor-pointer"
        >
          Xem
        </button>
        <button 
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(session.id);
          }}
          className="text-[11px] font-black uppercase py-2.5 rounded-xl bg-amber-50/30 hover:bg-amber-50 text-amber-600 border border-amber-100/30 transition-colors active:scale-95 text-center flex items-center justify-center cursor-pointer z-10"
        >
          Sửa
        </button>
        {canDelete && (
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            className="text-[11px] font-black uppercase py-2.5 rounded-xl bg-red-50/30 hover:bg-red-50 text-toyota-red border border-red-100/30 transition-colors active:scale-95 relative z-10 text-center flex items-center justify-center cursor-pointer"
          >
            Xoá
          </button>
        )}
      </div>
    </motion.div>
  );
}
