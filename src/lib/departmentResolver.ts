/**
 * Normalize department values from any of the legacy or localized naming schemes.
 * service → service
 * dichvu → service
 * dịch vụ → service
 * 
 * insurance → insurance
 * baohiem → insurance
 * bảo hiểm → insurance
 * 
 * phukien → phukien
 * phụ kiện → phukien
 */
export function normalizeDepartmentValue(val?: string | null): string | null {
  if (!val) return null;
  const t = val.trim().toLowerCase();
  
  if (t === 'service' || t === 'dichvu' || t === 'dịch vụ') {
    return 'service';
  }
  if (t === 'insurance' || t === 'baohiem' || t === 'bảo hiểm' || t === 'baohiem') {
    return 'baohiem';
  }
  if (t === 'phukien' || t === 'phụ kiện') {
    return 'phukien';
  }
  return t;
}

/**
 * Resolves a session's departmentId according to the specified priority checklist:
 * 1. session.departmentId
 * 2. session.department
 * 3. session.creatorDepartment
 * 4. session.createdByDepartment
 * 5. Default fallback to "service" if none of the above are defined or after normalization they are empty.
 */
export function resolveSessionDepartmentId(session: any): string {
  const rawValue = session.departmentId
    || session.department
    || session.creatorDepartment
    || session.createdByDepartment
    || null;

  const normalized = normalizeDepartmentValue(rawValue);
  return normalized || "service";
}
