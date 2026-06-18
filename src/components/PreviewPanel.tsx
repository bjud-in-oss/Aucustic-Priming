import React from 'react';
import { Globe, Loader2 } from 'lucide-react';

interface PreviewPanelProps {
  previewUrl: string | null;
}

export function PreviewPanel({ previewUrl }: PreviewPanelProps) {
  return (
    <div className="lg:w-1/3 flex flex-col bg-white border border-[#E5E5E5] shadow-sm relative overflow-hidden shrink-0 min-h-[400px]">
      <div className="bg-[#121212] text-white p-3 flex items-center justify-between shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#0047AB]" />
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#E5E5E5]">Container Preview</span>
        </div>
        {previewUrl ? 
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] hover:underline text-[#0047AB] font-mono truncate max-w-[150px] block">{previewUrl}</a> :
          <span className="text-[9px] text-[#666] font-mono">No active port</span>
        }
      </div>
      <div className="flex-1 w-full bg-[#FAF9F6]">
        {previewUrl ? (
          <iframe src={previewUrl} className="w-full h-full border-none" title="Live Preview" allow="cross-origin-isolated" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[#999] p-6 text-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-[#121212]/20" />
            <p className="text-xs italic font-serif opacity-80">Awaiting WebContainer server bindings...</p>
            <p className="text-[9px] uppercase tracking-widest font-bold mt-2">Waiting for 'npm run dev'</p>
          </div>
        )}
      </div>
    </div>
  );
}
