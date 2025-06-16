import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ToolTypes } from "./App";

// ★ Helpers for Fill
const hexToRgba = (hex: string): [number, number, number, number] => {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b, 255];
};

const colorsMatch = (a: Uint8ClampedArray, b: Uint8ClampedArray, idx: number): boolean =>
  a[idx] === b[0] &&
  a[idx + 1] === b[1] &&
  a[idx + 2] === b[2] &&
  a[idx + 3] === b[3];

// ★ Flood-fill algorithm (stack-based)
const floodFill = (
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillHex: string
) => {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const targetIdx = (Math.floor(startY) * width + Math.floor(startX)) * 4;
  const targetColor: [number, number, number, number] = [
    data[targetIdx],
    data[targetIdx + 1],
    data[targetIdx + 2],
    data[targetIdx + 3],
  ];
  const fillColor = hexToRgba(fillHex);

  // If clicking on same color, nothing to do
  if (
    targetColor[0] === fillColor[0] &&
    targetColor[1] === fillColor[1] &&
    targetColor[2] === fillColor[2] &&
    targetColor[3] === fillColor[3]
  ) {
    return;
  }

  const stack: [number, number][] = [[startX, startY]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const idx = (yi * width + xi) * 4;

    if (xi < 0 || xi >= width || yi < 0 || yi >= height) continue;
    if (!colorsMatch(data, new Uint8ClampedArray(fillColor), idx) &&
        data[idx] === targetColor[0] &&
        data[idx + 1] === targetColor[1] &&
        data[idx + 2] === targetColor[2] &&
        data[idx + 3] === targetColor[3]
    ) {
      // fill pixel
      data[idx] = fillColor[0];
      data[idx + 1] = fillColor[1];
      data[idx + 2] = fillColor[2];
      data[idx + 3] = fillColor[3];
      // push neighbors
      stack.push([xi + 1, yi]);
      stack.push([xi - 1, yi]);
      stack.push([xi, yi + 1]);
      stack.push([xi, yi - 1]);
    }
  }

  ctx.putImageData(imageData, 0, 0);
};

export type CanvasRef = {
  clearCanvas: () => void;
  undo: () => void;
  canUndo: () => boolean;
};

type CanvasProps = {
  selectedColor: string;
  brushSize: number;
  isErasing: boolean;
  ref: React.RefObject<CanvasRef | null>;
  currentTool: ToolTypes;
  onUpdateUndoState: () => void;
};

const CanvasComponent = ({
  selectedColor,
  brushSize,
  isErasing,
  currentTool,
  onUpdateUndoState,
  ref,
}: CanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasContext, setCanvasContext] =
    useState<CanvasRenderingContext2D | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [historyState, setHistoryState] = useState<{
    history: string[];
    currentIndex: number;
  }>({
    history: [],
    currentIndex: -1,
  });
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null
  );
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(
    null
  );

  const maxHistorySize = 20;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 5;
        setCanvasContext(ctx);
      }

      const preview = document.createElement("canvas");
      preview.width = canvas.width;
      preview.height = canvas.height;
      setPreviewCanvas(preview);
    }
  }, []);

  useEffect(() => {
    if (canvasContext && canvasRef.current) {
      setTimeout(() => {
        const imageData = canvasRef.current!.toDataURL();
        setHistoryState({
          history: [imageData],
          currentIndex: 0,
        });
      }, 0);
    }
  }, [canvasContext]);

  const saveCanvasState = useCallback(() => {
    if (canvasRef.current) {
      const imageData = canvasRef.current.toDataURL();
      setHistoryState((prev) => {
        const history = prev.history.slice(0, prev.currentIndex + 1);
        history.push(imageData);
        if (history.length > maxHistorySize) history.shift();
        return {
          history,
          currentIndex: history.length - 1,
        };
      });
      setTimeout(onUpdateUndoState, 0);
    }
  }, [maxHistorySize, onUpdateUndoState]);

  const restoreCanvasState = useCallback(
    (imageData: string) => {
      if (canvasContext && canvasRef.current) {
        const img = new Image();
        img.onload = () => {
          canvasContext.clearRect(
            0,
            0,
            canvasRef.current!.width,
            canvasRef.current!.height
          );
          canvasContext.drawImage(img, 0, 0);
        };
        img.src = imageData;
      }
    },
    [canvasContext]
  );

  useEffect(() => {
    if (!canvasContext) return;
    if (isErasing) {
      canvasContext.globalCompositeOperation = "destination-out";
      canvasContext.strokeStyle = "rgba(0,0,0,1)";
    } else {
      canvasContext.globalCompositeOperation = "source-over";
      canvasContext.strokeStyle = selectedColor;
    }
    canvasContext.lineWidth = brushSize;
  }, [selectedColor, brushSize, isErasing, canvasContext]);

  const drawLine = (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  };
  const drawRectangle = (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ) => {
    const width = endX - startX;
    const height = endY - startY;
    ctx.beginPath();
    ctx.rect(startX, startY, width, height);
    ctx.stroke();
  };
  const drawCircle = (
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ) => {
    const radius = Math.sqrt(
      Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );
    ctx.beginPath();
    ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
    ctx.stroke();
  };

  const getMouseCoordinates = (
    event: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasContext) return;
    const { x, y } = getMouseCoordinates(event);

    // ★ Fill tool: bucket-fill on click, then save state
    if (currentTool === "fill") {
      floodFill(canvasContext, x, y, selectedColor);
      saveCanvasState();
      return;
    }

    if (currentTool === "brush") {
      canvasContext.beginPath();
      canvasContext.moveTo(x, y);
      setIsDrawing(true);
    } else {
      setStartPoint({ x, y });
      setIsDrawing(true);
      if (previewCanvas) {
        const curr = canvasContext.getImageData(
          0,
          0,
          previewCanvas.width,
          previewCanvas.height
        );
        const pCtx = previewCanvas.getContext("2d")!;
        pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        pCtx.putImageData(curr, 0, 0);
      }
    }
  };

  const draw = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasContext) return;
    const { x, y } = getMouseCoordinates(event);

    if (currentTool === "brush") {
      canvasContext.lineTo(x, y);
      canvasContext.stroke();
    } else if (startPoint && previewCanvas) {
      const pCtx = previewCanvas.getContext("2d")!;
      const snapshot = pCtx.getImageData(
        0,
        0,
        previewCanvas.width,
        previewCanvas.height
      );
      canvasContext.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      canvasContext.putImageData(snapshot, 0, 0);

      canvasContext.globalAlpha = 0.7;
      switch (currentTool) {
        case "line":
          drawLine(canvasContext, startPoint.x, startPoint.y, x, y);
          break;
        case "rectangle":
          drawRectangle(canvasContext, startPoint.x, startPoint.y, x, y);
          break;
        case "circle":
          drawCircle(canvasContext, startPoint.x, startPoint.y, x, y);
          break;
      }
      canvasContext.globalAlpha = 1.0;
    }
  };

  const stopDrawing = (event?: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasContext) return;
    if (!isDrawing) return;

    if (currentTool === "brush") {
      canvasContext.closePath();
    } else if (startPoint && event) {
      const { x, y } = getMouseCoordinates(event);
      const pCtx = previewCanvas!.getContext("2d")!;
      const snapshot = pCtx.getImageData(
        0,
        0,
        previewCanvas!.width,
        previewCanvas!.height
      );
      canvasContext.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      canvasContext.putImageData(snapshot, 0, 0);

      switch (currentTool) {
        case "line":
          drawLine(canvasContext, startPoint.x, startPoint.y, x, y);
          break;
        case "rectangle":
          drawRectangle(canvasContext, startPoint.x, startPoint.y, x, y);
          break;
        case "circle":
          drawCircle(canvasContext, startPoint.x, startPoint.y, x, y);
          break;
      }
      setStartPoint(null);
    }

    setIsDrawing(false);
    saveCanvasState();
  };

  useImperativeHandle(
    ref,
    () => ({
      clearCanvas: () => {
        if (canvasContext) {
          canvasContext.clearRect(
            0,
            0,
            canvasRef.current!.width,
            canvasRef.current!.height
          );
          saveCanvasState();
        }
      },
      undo: () => {
        if (historyState.currentIndex > 0) {
          const prev = historyState.currentIndex - 1;
          setHistoryState((h) => ({ ...h, currentIndex: prev }));
          restoreCanvasState(historyState.history[prev]);
          setTimeout(onUpdateUndoState, 0);
        }
      },
      canUndo: () => historyState.currentIndex > 0,
    }),
    [canvasContext, historyState, onUpdateUndoState, restoreCanvasState, saveCanvasState]
  );

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
      <canvas
        ref={canvasRef}
        id="doodleCanvas"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        style={{
          border: "2px solid #333333",
          borderRadius: "8px",
          cursor: "crosshair",
          backgroundColor: "#ffffff",
          width: "90vw",
          height: "80vh",
        }}
      >
        Your browser does not support HTML5 canvas API!
      </canvas>
    </div>
  );
};

export default CanvasComponent;
