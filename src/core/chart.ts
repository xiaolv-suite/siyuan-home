/**
 * 现代轻量 SVG 贝塞尔平滑曲线与面积生成器（Issue #128 中枢美学规范）
 * 吸收小驴打卡与现代金融/健康类 App 的柔和平滑贝塞尔 S 走势曲线，替换生硬折线图。
 */

export interface ChartPoint {
    x: number;
    y: number;
}

/**
 * 将一组二维坐标点序列转换为平滑的三次贝塞尔曲线路径（Cubic Bezier Path，C1 连续）。
 * @param points 坐标点数组
 * @param tension 平滑张力系数（0.15~0.3 为最佳视觉温和度，默认 0.2）
 */
export function pointsToSmoothBezierPath(points: readonly ChartPoint[], tension = 0.2): string {
    if (!points || points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    if (points.length === 2) {
        return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
    }

    const round = (n: number) => Number(n.toFixed(1));
    let path = `M ${round(points[0].x)} ${round(points[0].y)}`;

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i + 2 < points.length ? points[i + 2] : p2;

        const cp1x = round(p1.x + (p2.x - p0.x) * tension);
        const cp1y = round(p1.y + (p2.y - p0.y) * tension);
        const cp2x = round(p2.x - (p3.x - p1.x) * tension);
        const cp2y = round(p2.y - (p3.y - p1.y) * tension);

        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${round(p2.x)} ${round(p2.y)}`;
    }

    return path;
}

/**
 * 将坐标点序列生成封闭的底部平滑渐变面积路径（可用于 SVG fill 渐变背景）。
 * @param points 坐标点数组
 * @param baselineY 封闭底部的基准 Y 坐标
 * @param tension 平滑张力系数
 */
export function pointsToAreaBezierPath(points: readonly ChartPoint[], baselineY: number, tension = 0.2): string {
    if (!points || points.length === 0) return "";
    const linePath = pointsToSmoothBezierPath(points, tension);
    if (!linePath) return "";

    const first = points[0];
    const last = points[points.length - 1];
    const round = (n: number) => Number(n.toFixed(1));

    return `${linePath} L ${round(last.x)} ${round(baselineY)} L ${round(first.x)} ${round(baselineY)} Z`;
}
