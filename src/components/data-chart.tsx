
"use client"

import * as React from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Pie, PieChart, Cell, ResponsiveContainer, Label, Legend } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart"
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

export function DataChart({ type, data, config, dataKeys, index, layout = 'horizontal', variant, curveType = 'monotone' }: DataChartProps) {
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

        const totalValue = React.useMemo(() => {
            return data.reduce((acc, curr) => acc + curr[dataKeys[0]], 0)
        }, [data, dataKeys])

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
                  innerRadius="65%"
                  strokeWidth={5}
                >
                   {data.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={chartConfig[entry[index]]?.color} />
                  ))}
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy}
                              className="fill-foreground text-2xl font-bold font-headline"
                            >
                              ₦{totalValue.toLocaleString()}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 24}
                              className="fill-muted-foreground text-xs"
                            >
                              Total
                            </tspan>
                          </text>
                        )
                      }
                    }}
                  />
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey={index} />} className="-translate-y-2 flex-wrap" />
              </PieChart>
            </ChartContainer>
        )
    }

    const ChartComponent = type === 'bar' ? BarChart : AreaChart;

    return (
        <ChartContainer config={config} className="min-h-[250px] w-full">
            <ChartComponent data={data} margin={{ left: 0, right: 0, top: 10, bottom: 0 }} accessibilityLayer>
                <defs>
                    {dataKeys.map(key => (
                        <linearGradient key={`gradient-${key}`} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0}/>
                        </linearGradient>
                    ))}
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--muted-foreground) / 0.1)" />
                <XAxis 
                    dataKey={index} 
                    tickLine={false} 
                    axisLine={false} 
                    tickMargin={12} 
                    fontSize={12}
                    className="fill-muted-foreground font-medium"
                />
                <YAxis 
                    tickLine={false} 
                    axisLine={false} 
                    tickMargin={8} 
                    fontSize={12} 
                    className="fill-muted-foreground font-medium"
                    tickFormatter={(value) => `₦${Number(value).toLocaleString()}`} 
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent />} />
                {dataKeys.map(key => (
                     type === 'area' ? (
                        <Area
                            key={key}
                            type={curveType}
                            dataKey={key}
                            stroke={`var(--color-${key})`}
                            fill={`url(#fill-${key})`}
                            strokeWidth={3}
                            dot={{ r: 4, fill: `var(--color-${key})`, strokeWidth: 2, stroke: 'white' }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                     ) : (
                        <Bar 
                            key={key} 
                            dataKey={key} 
                            fill={`var(--color-${key})`} 
                            radius={[4, 4, 0, 0]}
                        />
                     )
                ))}
            </ChartComponent>
        </ChartContainer>
    )
}
