import React from 'react';
import { Recommendation, PlaceLink } from '../types';

interface ResultCardProps {
  recommendation: Recommendation;
}

const ResultCard: React.FC<ResultCardProps> = ({ recommendation }) => {
  // Simple function to format text with paragraphs
  const formatText = (text: string) => {
    return text.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {line}
        <br />
      </React.Fragment>
    ));
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden transition-all duration-500 hover:shadow-2xl border border-slate-100">
      {/* Header Pattern */}
      <div className="h-32 bg-gradient-to-r from-sky-400 to-indigo-500 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
             <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
               <path d="M0 100 C 20 0 50 0 100 100 Z" fill="white" />
             </svg>
        </div>
        <div className="absolute bottom-4 left-6 text-white">
          <h2 className="text-2xl font-bold tracking-tight shadow-black drop-shadow-md">推薦結果</h2>
        </div>
      </div>

      <div className="p-6 md:p-8">
        {/* Main Content */}
        <div className="prose prose-slate max-w-none mb-8 text-slate-700 leading-relaxed text-lg">
          {formatText(recommendation.content)}
        </div>

        {/* Links Section */}
        {recommendation.links.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">相關地圖資訊</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recommendation.links.map((link, idx) => (
                <a
                  key={idx}
                  href={link.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-4 bg-slate-50 rounded-xl hover:bg-sky-50 border border-slate-200 hover:border-sky-200 transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center mr-3 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="overflow-hidden">
                    <p className="font-medium text-slate-900 truncate group-hover:text-sky-700">{link.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">在 Google 地圖上查看</p>
                  </div>
                  <div className="ml-auto text-slate-400 group-hover:text-sky-500 group-hover:translate-x-1 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
        
        {recommendation.links.length === 0 && (
           <div className="mt-4 p-4 bg-yellow-50 text-yellow-800 rounded-lg text-sm border border-yellow-200">
             注意：此推薦可能未附帶確切的地圖連結，請自行搜尋確認。
           </div>
        )}
      </div>
    </div>
  );
};

export default ResultCard;