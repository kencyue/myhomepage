import React from 'react';

const LoadingOverlay: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6 animate-fade-in">
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 border-4 border-slate-200 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-sky-500 rounded-full border-t-transparent animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xl font-medium text-slate-700">正在搜尋絕美景點...</p>
        <p className="text-sm text-slate-500 mt-2">AI 嚮導正在翻閱地圖</p>
      </div>
    </div>
  );
};

export default LoadingOverlay;