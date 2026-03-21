import { useMemo } from "react";

interface Firefly {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  path: string;
}

interface BokehLight {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  color: string;
}

export function EveningFireflies() {
  // Generate fireflies with floating paths
  const fireflies = useMemo(() => {
    const fireflyArray: Firefly[] = [];
    for (let i = 0; i < 20; i++) {
      fireflyArray.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 2, // 2-5px
        duration: Math.random() * 8 + 6, // 6-14 seconds
        delay: Math.random() * 8,
        path: Math.random() > 0.5 ? "firefly-float-1" : "firefly-float-2",
      });
    }
    return fireflyArray;
  }, []);

  // Generate bokeh light orbs
  const bokehLights = useMemo(() => {
    const bokehArray: BokehLight[] = [];
    const colors = [
      "rgba(255, 200, 100, 0.3)",
      "rgba(255, 150, 80, 0.3)",
      "rgba(200, 150, 255, 0.2)",
    ];
    for (let i = 0; i < 15; i++) {
      bokehArray.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 40 + 30, // 30-70px
        duration: Math.random() * 8 + 10, // 10-18 seconds
        delay: Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    return bokehArray;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Bokeh background lights */}
      {bokehLights.map((light) => (
        <div
          key={`bokeh-${light.id}`}
          className="absolute rounded-full"
          style={{
            left: `${light.x}%`,
            top: `${light.y}%`,
            width: `${light.size}px`,
            height: `${light.size}px`,
            background: light.color,
            animation: `bokeh-pulse ${light.duration}s ease-in-out infinite`,
            animationDelay: `${light.delay}s`,
            filter: "blur(20px)",
          }}
        />
      ))}

      {/* Floating fireflies */}
      {fireflies.map((firefly) => (
        <div
          key={`firefly-${firefly.id}`}
          className="absolute rounded-full"
          style={{
            left: `${firefly.x}%`,
            top: `${firefly.y}%`,
            width: `${firefly.size}px`,
            height: `${firefly.size}px`,
            background: "rgba(255, 255, 150, 0.9)",
            animation: `${firefly.path} ${firefly.duration}s ease-in-out infinite, firefly-glow 2s ease-in-out infinite`,
            animationDelay: `${firefly.delay}s`,
            boxShadow: "0 0 10px 3px rgba(255, 255, 150, 0.6)",
            filter: "blur(0.5px)",
          }}
        />
      ))}
    </div>
  );
}
