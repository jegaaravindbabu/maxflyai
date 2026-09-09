import type React from "react";

// Shared line-icon set — one consistent style across the whole app (no emoji).
const ic = (children: React.ReactNode, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const icf = (children: React.ReactNode, size = 14) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none">{children}</svg>
);

export const IPlayFill = icf(<path d="M8 5.5v13l11-6.5z" />);
export const IPlayFillLg = icf(<path d="M8 5.5v13l11-6.5z" />, 20);
export const ITrash = ic(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></>);
export const IPlus = ic(<path d="M12 5v14M5 12h14" />);
export const IEdit = ic(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>);
export const IType = ic(<><path d="M5 7V5h14v2" /><path d="M12 5v14" /><path d="M9 19h6" /></>);
export const ICopy = ic(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
export const IDownload = ic(<><path d="M12 4v11" /><path d="m7 11 5 4 5-4" /><path d="M3 15v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /></>);
export const IUpload = ic(<><path d="M12 15V4" /><path d="m7 8 5-4 5 4" /><path d="M3 15v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /></>);
export const IUploadLg = ic(<><path d="M12 15V4" /><path d="m7 8 5-4 5 4" /><path d="M3 15v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /></>, 28);
export const IGrid = ic(<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>);
export const IGridLg = ic(<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>, 30);
export const IFilm = ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></>);
export const IFilmLg = ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18M8 4v16M16 4v16" /></>, 30);
export const ICaption = ic(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 13h4M13 13h4M7 16h7" /></>);
export const IHome = ic(<><path d="m3 10 9-7 9 7" /><path d="M5 8.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V8.5" /></>);
export const ITag = ic(<><path d="M12.6 2.6 21.4 11.4a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6z" /><circle cx="7.5" cy="7.5" r="1.5" /></>);
export const IGear = ic(<><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" /></>);
export const IScissors = ic(<><circle cx="6" cy="6" r="2.7" /><circle cx="6" cy="18" r="2.7" /><path d="M20 4 8.2 15.8" /><path d="M14.5 14.5 20 20" /><path d="M8.2 8.2 12 12" /></>);
export const IReset = ic(<><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 4v4h4" /></>);
export const IClapper = ic(<><path d="M20.2 6 3 11l-.9-3.2a2 2 0 0 1 1.4-2.5l13.5-3.6a2 2 0 0 1 2.4 1.4z" /><path d="M6.2 5.3 9.5 9M11 4l3.3 3.7M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>);
export const IGlobe = ic(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" /></>);
export const ISpeaker = ic(<><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></>);
export const INote = ic(<><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>);
export const ICloud = ic(<path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.5 3.8 3.8 0 0 0 6 19.9z" />);
export const ISparkle = ic(<><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>);
export const ISliders = ic(<><path d="M5 21v-6M5 11V3M12 21v-9M12 8V3M19 21v-4M19 13V3" /><path d="M2.5 15h5M9.5 8h5M16.5 17h5" /></>);
