import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

export default function EChart(props: { option: any; style?: React.CSSProperties }) {
  return <ReactEChartsCore echarts={echarts} option={props.option} notMerge lazyUpdate style={props.style || { height: 280 }} />;
}

/** Colores leídos de las variables CSS para que los gráficos sigan el tema claro/oscuro. */
export function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    ink: v("--ink"), muted: v("--muted"), line: v("--line"), water: v("--water"),
    waterSoft: v("--water-soft"), out: v("--out"), band: v("--band"), bg: v("--surface"),
    good: v("--good"), bad: v("--bad"), warn: v("--warn"),
  };
}

export function baseOption(t: ReturnType<typeof theme>) {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "IBM Plex Sans, system-ui, sans-serif", color: t.ink },
    grid: { left: 56, right: 18, top: 34, bottom: 30, containLabel: false },
    tooltip: { trigger: "axis", backgroundColor: t.bg, borderColor: t.line, textStyle: { color: t.ink }, valueFormatter: undefined },
    xAxis: { type: "time", axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted }, splitLine: { show: false } },
    yAxis: { type: "value", scale: true, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.line, type: "dashed" } }, nameTextStyle: { color: t.muted } },
    legend: { top: 0, textStyle: { color: t.muted }, itemWidth: 14, itemHeight: 8 },
  };
}
