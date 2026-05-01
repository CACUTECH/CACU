
"use client"

import * as React from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Pie, PieChart, Cell } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { CurveType } from "recharts/types/shape/Curve"

interface DataChartProps {
    type: 'bar' | 'area' | 'pie';
    data: any[];
    config: ChartConfig;
    dataKeys: string[];
    index: string;
    layout?: 'horizontal' | 'vertical';
    variant?: 'donut';
    curveType?: CurveType;
}

export function DataChart({ type, data, config, dataKeys, index, layout = 'horizontal', variant, curveType }: DataChartProps) {
    const ChartComponent = type === 'bar' ? BarChart : type === 'area' ? AreaChart : PieChart;
    const ChartElement = type === 'bar' ? Bar : type === 'area' ? Area : Pie;

    if (type === 'pie' && variant === 'donut') {
         const chartConfig = Object.keys(config).reduce((acc, key) => {
            const item = data.find(d => d[index] === key);
            if (item) {
                acc[key] = {
                    label: item[index],
                    color: config[key].color,
                };
            }
            return acc;
        }, {} as ChartConfig);

        return (
            <ChartContainer
              config={chartConfig}
              className="mx-auto aspect-square h-full"
            >
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel />}
                />
                <Pie
                  data={data}
                  dataKey={dataKeys[0]}
                  nameKey={index}
                  innerRadius="50%"
                  strokeWidth={5}
                >
                   {data.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={chartConfig[entry[index]]?.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
        )
    }

    return (
        <ChartContainer config={config} className="min-h-[200px] w-full">
            <ChartComponent data={data} margin={{ left: 12, right: 12, top: 12, bottom: 12 }} accessibilityLayer>
                <CartesianGrid vertical={layout === 'horizontal'} horizontal={layout === 'vertical'} strokeDasharray="3 3" vertical={false} />
                {layout === 'horizontal' ? (
                    <>
                        <XAxis dataKey={index} tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
                        <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} tickFormatter={(value) => `₦${Number(value)/1000}k`} />
                    </>
                ) : (
                    <>
                        <XAxis type="number" hide />
                        <YAxis dataKey={index} type="category" tickLine={false} axisLine={false} tickMargin={8} width={80} fontSize={12} />
                    </>
                )}
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <RechartsTooltip />
                {dataKeys.map(key => (
                     <ChartElement 
                        key={key} 
                        dataKey={key} 
                        fill={`var(--color-${key})`} 
                        stroke={`var(--color-${key})`} 
                        radius={type === 'bar' && layout === 'horizontal' ? 4 : 0}
                        radius={[0, 4, 4, 0]}
                        strokeWidth={type === 'area' ? 2 : 0}
                        dot={type === 'area' ? { r: 4, fill: `var(--color-${key})`, strokeWidth: 2, stroke: 'white' } : false}
                        activeDot={type === 'area' ? { r: 6, strokeWidth: 0 } : false}
                        fillOpacity={type === 'area' ? 0.3 : 1}
                        {...(type === 'area' && { type: curveType || 'monotone' })}
                     />
                ))}
            </ChartComponent>
        </ChartContainer>
    )
}
