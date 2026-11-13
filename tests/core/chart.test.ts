import { describe, it, expect } from "vitest";
import { pointsToSmoothBezierPath, pointsToAreaBezierPath } from "@/core/chart";

describe("chart (平滑贝塞尔曲线算法)", () => {
    it("空输入与单点边界容错", () => {
        expect(pointsToSmoothBezierPath([])).toBe("");
        expect(pointsToAreaBezierPath([], 100)).toBe("");
        expect(pointsToSmoothBezierPath([{ x: 10, y: 20 }])).toBe("M 10.0 20.0");
    });

    it("两点降级为直线段", () => {
        const pts = [{ x: 0, y: 10 }, { x: 50, y: 30 }];
        expect(pointsToSmoothBezierPath(pts)).toBe("M 0.0 10.0 L 50.0 30.0");
        expect(pointsToAreaBezierPath(pts, 100)).toBe("M 0.0 10.0 L 50.0 30.0 L 50 100 L 0 100 Z");
    });

    it("三点及以上生成三次贝塞尔平滑S走势曲线", () => {
        const pts = [
            { x: 10, y: 50 },
            { x: 40, y: 20 },
            { x: 70, y: 80 },
            { x: 100, y: 30 },
        ];
        const path = pointsToSmoothBezierPath(pts);
        expect(path.startsWith("M 10 50")).toBe(true);
        expect(path.includes("C")).toBe(true);
        // 应该包含 3 个三次贝塞尔曲线段
        const bezierSegments = path.match(/ C /g);
        expect(bezierSegments?.length).toBe(3);

        const areaPath = pointsToAreaBezierPath(pts, 100);
        expect(areaPath.endsWith("L 100 100 L 10 100 Z")).toBe(true);
    });

    it("支持自定义平滑张力系数 tension", () => {
        const pts = [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
            { x: 100, y: 0 },
        ];
        const pathTensionLow = pointsToSmoothBezierPath(pts, 0.1);
        const pathTensionHigh = pointsToSmoothBezierPath(pts, 0.4);
        expect(pathTensionLow).not.toBe(pathTensionHigh);
        expect(pathTensionLow.includes("C")).toBe(true);
        expect(pathTensionHigh.includes("C")).toBe(true);
    });
});
