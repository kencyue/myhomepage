import React from 'react';
import { Category, SearchType } from '../types';

interface ControlsProps {
  onSearch: (type: SearchType) => void;
  selectedCategory: Category;
  onCategoryChange: (category: Category) => void;
  isLoading: boolean;
}

const Controls: React.FC<ControlsProps> = ({ onSearch, selectedCategory, onCategoryChange, isLoading }) => {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-lg border border-slate-100">
      
      {/* Category Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-500 mb-3 ml-1">選擇旅行風格</label>
        <div className="flex flex-wrap gap-2">
          {Object.values(Category).map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              disabled={isLoading}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 
                ${selectedCategory === cat 
                  ? 'bg-sky-500 text-white shadow-md ring-2 ring-sky-200 ring-offset-1' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => onSearch(SearchType.GLOBAL)}
          disabled={isLoading}
          className={`flex items-center justify-center space-x-2 w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg shadow-indigo-200 transition-all transform active:scale-95
            ${isLoading ? 'bg-indigo-300 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 hover:shadow-xl'}
          `}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>全世界隨機</span>
        </button>

        <button
          onClick={() => onSearch(SearchType.NEARBY)}
          disabled={isLoading}
          className={`flex items-center justify-center space-x-2 w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg shadow-teal-200 transition-all transform active:scale-95
             ${isLoading ? 'bg-teal-300 cursor-not-allowed' : 'bg-gradient-to-r from-teal-400 to-emerald-500 hover:from-teal-500 hover:to-emerald-600 hover:shadow-xl'}
          `}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>搜尋附近</span>
        </button>
      </div>
    </div>
  );
};

export default Controls;