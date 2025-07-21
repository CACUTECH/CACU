"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

interface DataChartProps {
    type: 'bar' | 'area';
    data: any[];
    config: ChartConfig;
    dataKeys: string[];
    index: string;
    layout?: 'horizontal' | 'vertical';
}

export function DataChart({ type, data, config, dataKeys, index, layout = 'horizontal' }: DataChartProps) {
    const ChartComponent = type === 'bar' ? BarChart : AreaChart;
    const ChartElement = type === 'bar' ? Bar : Area;

    return (
        <ChartContainer config={config} className="min-h-[200px] w-full">
            <ChartComponent data={data} margin={{ left: 12, right: 12, top: 12, bottom: 12 }} accessibilityLayer>
                <CartesianGrid vertical={layout === 'horizontal'} horizontal={layout === 'vertical'} strokeDasharray="3 3" />
                {layout === 'horizontal' ? (
                    <>
                        <XAxis dataKey={index} tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
                        <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} tickFormatter={(value) => `$${Number(value)/1000}k`} />
                    </>
                ) : (
                    <>
                        <XAxis type="number" hide />
                        <YAxis dataKey={index} type="category" tickLine={false} axisLine={false} tickMargin={8} width={80} fontSize={12} />
                    </>
                )}
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator={type === 'area' ? 'dot' : 'line'} />} />
                <RechartsTooltip />
                {dataKeys.map(key => (
                     <ChartElement 
                        key={key} 
                        dataKey={key} 
                        fill={`var(--color-${key})`} 
                        stroke={`var(--color-${key})`} 
                        radius={type === 'bar' && layout === 'horizontal' ? 4 : 0}
                        radius={[0, 4, 4, 0]}
                     />
                ))}
            </ChartComponent>
        </ChartContainer>
    )
}
