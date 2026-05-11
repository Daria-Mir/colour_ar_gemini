/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Upload, ChevronLeft, ExternalLink, Check, Sparkles, ShoppingBag, Eye, Heart } from 'lucide-react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera as MPCamera } from '@mediapipe/camera_utils';
import { analyzeColors, findProducts, type ColorAnalysis, type Product } from './services/geminiService';

// --- Types ---
type Screen = 'upload' | 'analysis' | 'shop' | 'products' | 'ar';

const CHIPS: Record<string, string[]> = {
  makeup: ['Lipstick', 'Blush', 'Eyeshadow', 'Eyeliner', 'Foundation'],
  fashion: ['Dress', 'T-shirt', 'Jacket', 'Sweater', 'Accessories'],
  hair: ['Hair color', 'Shampoo', 'Treatment', 'Styling'],
  skincare: ['Moisturizer', 'Serum', 'SPF', 'Toner'],
};

const LIP_UPPER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const LIP_LOWER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const INNER_LIPS = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [image, setImage] = useState<{ base64: string; mime: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [analysis, setAnalysis] = useState<ColorAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>('');

  const [selectedCat, setSelectedCat] = useState('makeup');
  const [selectedChips, setSelectedChips] = useState<string[]>(['Lipstick']);
  const [products, setProducts] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // AR State
  const [arColor, setArColor] = useState<string>('');
  const [arOpacity, setArOpacity] = useState(0.55);
  const [arLoaded, setArLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<MPCamera | null>(null);
  const faceMeshRef = useRef<FaceMesh | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImage({ base64: dataUrl.split(',')[1], mime: file.type });
      setPreviewUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const startAnalysis = async () => {
    if (!image) return;
    setScreen('analysis');
    setIsAnalyzing(true);
    setError('');

    try {
      const result = await analyzeColors(image.base64, image.mime);
      setAnalysis(result);
    } catch (e: any) {
      setError(e.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const findMyProducts = async () => {
    if (!analysis) return;
    setScreen('products');
    setIsSearching(true);
    setError('');

    try {
      const result = await findProducts(analysis, selectedCat, selectedChips);
      setProducts(result);
      if (result.length > 0) {
        setSelectedProduct(result[0]);
        setArColor(result[0].hex);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to find products');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleChip = (chip: string) => {
    setSelectedChips(prev => {
      if (prev.includes(chip)) {
        return prev.length > 1 ? prev.filter(c => c !== chip) : prev;
      }
      return [...prev, chip];
    });
  };

  // --- AR Logic ---
  useEffect(() => {
    if (screen !== 'ar') {
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (faceMeshRef.current) {
        faceMeshRef.current.close().catch(() => {});
        faceMeshRef.current = null;
      }
      return;
    }

    const initAR = async () => {
      if (!videoRef.current || !canvasRef.current) return;
      setArLoaded(false);

      const faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      faceMesh.onResults((results) => {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (results.multiFaceLandmarks?.length > 0) {
          drawLips(ctx, results.multiFaceLandmarks[0], canvas.width, canvas.height);
        }
      });

      faceMeshRef.current = faceMesh;

      try {
        const camera = new MPCamera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width: 1280,
          height: 720
        });
        cameraRef.current = camera;
        await camera.start();
        setArLoaded(true);
      } catch (err) {
        console.error("Camera access error:", err);
        setError("Camera access denied.");
      }
    };

    initAR();
  }, [screen]);

  const drawLips = (ctx: CanvasRenderingContext2D, landmarks: any[], w: number, h: number) => {
    if (!arColor) return;
    const { r, g, b } = hexToRgb(arColor);

    const pt = (i: number) => [landmarks[i].x * w, landmarks[i].y * h];

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = arOpacity;
    ctx.fillStyle = `rgb(${r},${g},${b})`;

    ctx.beginPath();
    const outer = LIP_UPPER.map(i => pt(i));
    ctx.moveTo(outer[0][0], outer[0][1]);
    outer.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    const inner = INNER_LIPS.map(i => pt(i));
    ctx.moveTo(inner[0][0], inner[0][1]);
    inner.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  return (
    <div className="flex flex-col h-[100dvh] max-w-[500px] mx-auto bg-[#0d0d0d] overflow-hidden relative">
      <AnimatePresence mode="wait">
        
        {/* --- Screen: Upload --- */}
        {screen === 'upload' && (
          <motion.div 
            key="upload"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex flex-col h-full px-5 pb-9 pt-4 overflow-y-auto"
          >
            <Header />
            <StepIndicator current={1} />
            <h1 className="text-2xl font-medium mt-1 mb-1">Your photo</h1>
            <p className="text-white/45 text-sm mb-6">A clear selfie with natural light works best.</p>
            
            <div className="flex-1 space-y-6">
              <div className="relative">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className={`border-2 border-dashed border-white/20 rounded-3xl p-10 text-center transition-colors ${previewUrl ? 'bg-surface' : ''}`}>
                  {previewUrl ? (
                    <img src={previewUrl} className="w-full max-h-[300px] object-cover rounded-2xl mb-4" alt="Preview" />
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 bg-white/5 rounded-full">
                        <Upload size={32} className="text-white/40" />
                      </div>
                      <div>
                        <p className="text-base font-medium">Tap to upload or take a photo</p>
                        <p className="text-xs text-white/45 mt-1">Camera roll and instant photos supported</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {previewUrl && (
                <button 
                  className="w-full py-4 bg-pink rounded-2xl font-medium flex items-center justify-center gap-2"
                  onClick={startAnalysis}
                >
                  <Sparkles size={18} />
                  Analyze my colors
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* --- Screen: Analysis --- */}
        {screen === 'analysis' && (
          <motion.div 
            key="analysis"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-full px-5 pb-9 pt-4 overflow-y-auto"
          >
            <Header showBack onBack={() => setScreen('upload')} />
            <StepIndicator current={2} />

            {isAnalyzing ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="pulse-ring w-20 h-20 rounded-full border-2 border-pink flex items-center justify-center mb-6">
                  <Sparkles size={32} className="text-pink" />
                </div>
                <p className="text-lg font-medium">Analyzing your colors...</p>
                <p className="text-sm text-white/45 mt-2">Gemini AI is mapping your unique palette</p>
              </div>
            ) : analysis ? (
              <div className="flex-1 space-y-6">
                <img src={previewUrl} className="w-full max-h-[220px] object-cover rounded-2xl" alt="Analyzed" />
                
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-pink/15 border border-pink/30 rounded-full text-pink-light text-sm font-medium">
                  <Sparkles size={14} />
                  {analysis.season} · {analysis.undertone}
                </div>

                <div className="bg-surface p-4 rounded-2xl text-sm leading-relaxed text-white/70 italic">
                  "{analysis.description}"
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface p-4 rounded-2xl">
                    <p className="text-[10px] uppercase tracking-wider text-white/20 mb-3">Best Colors</p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.bestColors.map((c, i) => (
                        <div key={i} className="w-7 h-7 rounded-full border border-white/10" style={{ backgroundColor: c.hex }} title={c.name} />
                      ))}
                    </div>
                  </div>
                  <div className="bg-surface p-4 rounded-2xl">
                    <p className="text-[10px] uppercase tracking-wider text-white/20 mb-3">Avoid</p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.avoidColors.map((c, i) => (
                        <div key={i} className="w-7 h-7 rounded-full border border-white/10" style={{ backgroundColor: c.hex }} title={c.name} />
                      ))}
                    </div>
                  </div>
                  <div className="bg-surface p-4 rounded-2xl">
                    <p className="text-[10px] uppercase tracking-wider text-white/20 mb-3">Features</p>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[11px] px-2 py-0.5 bg-surface-2 rounded-lg text-white/40">{analysis.skinTone} skin</span>
                      <span className="text-[11px] px-2 py-0.5 bg-surface-2 rounded-lg text-white/40">{analysis.eyeColor} eyes</span>
                      <span className="text-[11px] px-2 py-0.5 bg-surface-2 rounded-lg text-white/40">{analysis.contrast} contr.</span>
                    </div>
                  </div>
                  <div className="bg-surface p-4 rounded-2xl">
                    <p className="text-[10px] uppercase tracking-wider text-white/20 mb-3">Neutrals</p>
                    <div className="flex flex-wrap gap-2">
                       {analysis.neutrals.map((c, i) => (
                        <div key={i} className="w-7 h-7 rounded-full border border-white/10" style={{ backgroundColor: c.hex }} title={c.name} />
                      ))}
                    </div>
                  </div>
                </div>

                <button 
                  className="w-full py-4 bg-pink rounded-2xl font-medium"
                  onClick={() => setScreen('shop')}
                >
                  Shop my palette →
                </button>
              </div>
            ) : error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm">
                {error}
              </div>
            )}
          </motion.div>
        )}

        {/* --- Screen: Shop --- */}
        {screen === 'shop' && (
          <motion.div 
            key="shop"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col h-full px-5 pb-9 pt-4 overflow-y-auto"
          >
            <Header showBack onBack={() => setScreen('analysis')} />
            <StepIndicator current={3} />
            <h1 className="text-2xl font-medium mt-1 mb-6">What are you shopping for?</h1>

            <div className="flex-1 space-y-8">
              <div className="grid grid-cols-2 gap-3">
                {['makeup', 'fashion', 'hair', 'skincare'].map(cat => (
                  <div 
                    key={cat}
                    onClick={() => { setSelectedCat(cat); setSelectedChips([CHIPS[cat][0]]); }}
                    className={`p-4 rounded-2xl cursor-pointer border transition-all ${selectedCat === cat ? 'bg-pink/10 border-pink' : 'bg-surface border-transparent'}`}
                  >
                    <p className="text-2xl mb-2">
                      {cat === 'makeup' ? '💄' : cat === 'fashion' ? '👗' : cat === 'hair' ? '✂️' : '🌿'}
                    </p>
                    <p className="font-medium capitalize">{cat}</p>
                    <p className="text-[11px] text-white/40 mt-1">
                      {cat === 'makeup' ? 'Lips, eyes, face' : cat === 'fashion' ? 'Clothing & accessories' : cat === 'hair' ? 'Color & care' : 'Foundation-ready skin'}
                    </p>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/20 mb-4 font-bold">Subcategories</p>
                <div className="flex flex-wrap gap-2">
                  {CHIPS[selectedCat].map(chip => (
                    <button
                      key={chip}
                      onClick={() => toggleChip(chip)}
                      className={`px-4 py-2 rounded-full text-sm border transition-all ${selectedChips.includes(chip) ? 'bg-pink/20 border-pink text-pink-light' : 'border-white/10 text-white/45'}`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button 
              className="w-full py-4 bg-pink rounded-2xl font-medium mt-8"
              onClick={findMyProducts}
            >
              Find my products →
            </button>
          </motion.div>
        )}

        {/* --- Screen: Products --- */}
        {screen === 'products' && (
          <motion.div 
            key="products"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col h-full px-5 pb-9 pt-4 overflow-y-auto"
          >
            <Header showBack onBack={() => setScreen('shop')} />
            <StepIndicator current={4} />
            
            {isSearching ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Spinner />
                <p className="text-lg font-medium mt-4">Matching your palette...</p>
                <p className="text-sm text-white/45 mt-2">Finding perfect {selectedCat} shades for you</p>
              </div>
            ) : (
              <div className="flex-1 space-y-6">
                <p className="text-sm text-white/45">{products.length} products matched to your {analysis?.season} palette</p>
                
                <div className="space-y-3">
                  {products.map((p, i) => (
                    <div 
                      key={i}
                      onClick={() => { setSelectedProduct(p); setArColor(p.hex); }}
                      className={`p-3.5 bg-surface border rounded-2xl flex gap-3.5 items-center cursor-pointer transition-all ${selectedProduct === p ? 'border-pink' : 'border-transparent'}`}
                    >
                      <div className="w-14 h-14 rounded-xl border border-white/10 shrink-0" style={{ backgroundColor: p.hex }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-white/20">{p.brand}</p>
                        <p className="font-medium truncate">{p.name}</p>
                        <p className="text-xs text-white/45 truncate mt-0.5">{p.shade}</p>
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-[9px] mt-1.5">
                          <Check size={10} />
                          Palette match
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <p className="font-semibold text-pink">{p.price}</p>
                        <a 
                          href={p.sephora_url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="px-2 py-1 border border-white/10 rounded-lg text-white/20 text-[10px]"
                        >
                          View <ExternalLink size={10} className="inline ml-1" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    className="w-full py-4 bg-pink rounded-2xl font-medium flex items-center justify-center gap-2"
                    onClick={() => setScreen('ar')}
                  >
                    <Eye size={18} />
                    Try on with AR camera
                  </button>
                  <button 
                    className="w-full py-3 text-white/40 text-sm"
                    onClick={() => setScreen('shop')}
                  >
                    Change selection
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* --- Screen: AR --- */}
        {screen === 'ar' && (
          <motion.div 
            key="ar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-full bg-black relative"
          >
            {!arLoaded && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black gap-4">
                <Spinner />
                <p className="text-sm text-white/45">Starting camera...</p>
              </div>
            )}

            <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none" />

            {/* AR Overlay Top */}
            <div className="absolute top-0 left-0 right-0 p-5 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent z-10 pt-safe">
              <button className="flex items-center gap-1.5 text-sm text-white/70" onClick={() => setScreen('products')}>
                <ChevronLeft size={18} />
                Exit
              </button>
              <div className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-widest border border-white/10 ${arLoaded ? 'text-green-400' : 'text-white/40'}`}>
                {arLoaded ? 'AR ACTIVE' : 'LOADING'}
              </div>
              <div className="logo text-sm font-medium"><span>✦</span> AR</div>
            </div>

            {/* AR Overlay Bottom */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/85 to-transparent p-6 pb-12 z-10">
              {selectedProduct && (
                <div className="mb-5">
                  <p className="text-xs text-white/50 mb-1">{selectedProduct.brand} · {selectedProduct.name}</p>
                  <p className="text-xl font-medium">{selectedProduct.shade}</p>
                </div>
              )}

              {/* Swatches */}
              <div className="flex gap-2.5 overflow-x-auto pb-4 no-scrollbar mb-4">
                {analysis?.lipShades.map((s, i) => (
                  <button 
                    key={i}
                    onClick={() => { setArColor(s.hex); }}
                    className={`w-10 h-10 rounded-full shrink-0 border-2 transition-all ${arColor === s.hex ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: s.hex }}
                  />
                ))}
              </div>

              {/* Intensity */}
              <div className="flex items-center gap-4 mb-6">
                <label className="text-[11px] uppercase tracking-wider text-white/40 w-16">Intensity</label>
                <input 
                  type="range" 
                  min="10" 
                  max="90" 
                  value={arOpacity * 100} 
                  onChange={(e) => setArOpacity(parseInt(e.target.value) / 100)} 
                  className="flex-1 accent-pink h-1 bg-white/10 rounded-lg appearance-none"
                />
                <span className="text-[11px] text-white/40 w-8 text-right">{Math.round(arOpacity * 100)}%</span>
              </div>

              <button 
                className="w-full py-4 bg-white/10 border border-white/10 rounded-2xl text-white/70 font-medium text-sm"
                onClick={() => setScreen('products')}
              >
                Exit AR
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

function Header({ showBack, onBack }: { showBack?: boolean; onBack?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-4 flex-shrink-0 min-h-[44px]">
      <div className="logo text-lg tracking-wider">
        <span className="text-pink">✦</span> Hue & You
      </div>
      {showBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-white/45">
          <ChevronLeft size={16} />
          Back
        </button>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-6 flex-shrink-0">
      {[1, 2, 3, 4].map(num => (
        <React.Fragment key={num}>
          <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] shrink-0 ${num < current ? 'bg-pink border-pink' : num === current ? 'border-pink text-pink font-bold' : 'border-white/10 text-white/20'}`}>
            {num < current ? '✓' : num}
          </div>
          {num < 4 && (
            <div className={`flex-1 h-[1px] ${num < current ? 'bg-pink' : 'bg-white/10'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-10 h-10 border-2 border-white/5 border-t-pink rounded-full animate-spin" />
  );
}
