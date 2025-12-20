import React, { useState, useEffect } from 'react';
import { getTravelRecommendation } from './services/gemini';
import { Recommendation, Category, SearchType, GeoLocation } from './types';
import ResultCard from './components/ResultCard';
import Controls from './components/Controls';
import LoadingOverlay from './components/LoadingOverlay';

const App: React.FC = () => {
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(Category.ALL);
  const [history, setHistory] = useState<Recommendation[]>([]);

  const handleSearch = async (type: SearchType) => {
    setLoading(true);
    setError(null);
    setRecommendation(null);

    try {
      let location: GeoLocation | null = null;

      if (type === SearchType.NEARBY) {
        try {
          location = await getGeoLocation();
        } catch (locError) {
          setError("無法獲取您的位置資訊。請允許瀏覽器存取位置，或改用「全世界隨機」模式。");
          setLoading(false);
          return;
        }
      }

      const result = await getTravelRecommendation(category, location);
      setRecommendation(result);
      setHistory(prev => [result, ...prev].slice(0, 5)); // Keep last 5
    } catch (err) {
      setError(err instanceof Error ? err.message : "發生未知錯誤");
    } finally {
      setLoading(false);
    }
  };

  const getGeoLocation = (): Promise<GeoLocation> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser."));
      } else {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
          },
          (error) => {
            reject(error);
          }
        );
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <nav className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🌍</span>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-sky-500 to-indigo-600">
                隨機旅程
              </h1>
            </div>
            {history.length > 0 && (
              <button 
                onClick={() => setHistory([])}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                清除紀錄
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-grow max-w-3xl mx-auto w-full px-4 py-8 sm:px-6">
        
        {/* Intro Section */}
        {!recommendation && !loading && !error && (
          <div className="text-center mb-12 animate-fade-in-up">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-800 mb-4 tracking-tight">
              探索您的下一個<br />
              <span className="text-sky-500">冒險目的地</span>
            </h2>
            <p className="text-lg text-slate-600 max-w-xl mx-auto">
              無論是尋找身邊的隱藏秘境，還是夢想遠方的異國情調。讓 AI 為您指引方向，發現世界的驚奇。
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="mb-8">
          <Controls 
            onSearch={handleSearch} 
            selectedCategory={category} 
            onCategoryChange={setCategory}
            isLoading={loading}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700 animate-shake">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="font-semibold">發生錯誤</h3>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="py-12">
            <LoadingOverlay />
          </div>
        )}

        {/* Result */}
        {recommendation && !loading && (
          <div className="animate-fade-in-up">
            <ResultCard recommendation={recommendation} />
          </div>
        )}

        {/* Previous Recommendations (Simplified History) */}
        {!loading && history.length > 1 && (
          <div className="mt-12 pt-8 border-t border-slate-200">
            <h3 className="text-lg font-bold text-slate-700 mb-4">最近的發現</h3>
            <div className="space-y-4">
              {history.slice(1).map((item) => (
                <div key={item.timestamp} className="bg-white p-4 rounded-lg shadow-sm border border-slate-100 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setRecommendation(item)}>
                  <div className="flex justify-between items-start">
                    <p className="text-slate-600 line-clamp-2 text-sm">
                      {item.content.slice(0, 100)}...
                    </p>
                    <span className="text-xs text-slate-400 whitespace-nowrap ml-2">
                      {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-8">
        <div className="max-w-4xl mx-auto px-4 text-center text-slate-400 text-sm">
          <p>© {new Date().getFullYear()} 隨機旅程. Powered by Google Gemini.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;