import { Metadata } from '@penumbra-zone/protobuf/penumbra/core/asset/v1/asset_pb';
import { CandlestickData } from '@penumbra-zone/protobuf/penumbra/core/component/dex/v1/dex_pb';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { curveLinear } from '@visx/curve';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { useParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { BoxPlot } from '@visx/stats';
import { Threshold } from '@visx/threshold';
import { Tooltip, withTooltip } from '@visx/tooltip';
import { WithTooltipProvidedProps } from '@visx/tooltip/lib/enhancers/withTooltip';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

// accessors
const blockHeight = (d: CandlestickData) => Number(d.height);
const lowPrice = (d: CandlestickData) => d.low;
const highPrice = (d: CandlestickData) => d.high;
const openPrice = (d: CandlestickData) => d.open;
const closePrice = (d: CandlestickData) => d.close;
const midPrice = (d: CandlestickData) => (openPrice(d) + closePrice(d)) / 2;
const priceMovement = (d: CandlestickData) => closePrice(d) - openPrice(d);
const priceMovementColor = (d: CandlestickData) => {
  const movement = priceMovement(d);
  if (movement > 0) {
    return 'green';
  } else if (movement < 0) {
    return 'red';
  } else {
    return 'white';
  }
};

type GetBlockDateFn = (h: bigint, s?: AbortSignal) => Promise<Date | undefined>;

interface CandlestickPlotProps {
  className: React.HTMLAttributes<HTMLDivElement>['className'];

  parentWidth?: number;
  parentHeight?: number;
  width?: number;
  height?: number;
  candles: CandlestickData[];
  blockDomain: [bigint, bigint];
  startMetadata: Metadata;
  endMetadata: Metadata;
  getBlockDate: GetBlockDateFn;
  scaleMargin?: number;
}

interface CandlestickTooltipProps {
  top?: number;
  left?: number;
  data: CandlestickData;
  startMetadata: Metadata;
  endMetadata: Metadata;
  getBlockDate: GetBlockDateFn;
}

export const CandlestickPlot = withTooltip<CandlestickPlotProps, CandlestickData>(
  ({
    className,

    // plot props
    candles,
    startMetadata,
    endMetadata,
    blockDomain: [startBlock, endBlock],
    getBlockDate,
    scaleMargin = 40,

    // withTooltip props
    tooltipOpen,
    tooltipLeft,
    tooltipTop,
    tooltipData,
    showTooltip,
    hideTooltip,
  }: CandlestickPlotProps & WithTooltipProvidedProps<CandlestickData>) => {
    const { parentRef, width: w, height: h } = useParentSize();

    const { blockScale, priceScale } = useMemo(() => {
      const { maxPrice, minPrice } = candles.reduce(
        (acc, d) => ({
          minPrice: Math.min(acc.minPrice, lowPrice(d)),
          maxPrice: Math.max(acc.maxPrice, highPrice(d)),
        }),
        { minPrice: Infinity, maxPrice: 0 },
      );

      const maxSpread = maxPrice - minPrice;

      const blockScale = scaleLinear<number>({
        range: [scaleMargin, w],
        domain: [Number(startBlock), Number(endBlock)],
      });

      const priceScale = scaleLinear<number>({
        range: [h - scaleMargin, 0],
        domain: [Math.max(0, minPrice - maxSpread / 4), maxPrice],
      });

      return { priceScale, blockScale };
    }, [candles, scaleMargin, w, startBlock, endBlock, h]);

    const useTooltip = useCallback(
      (d: CandlestickData) => ({
        onMouseOver: () => {
          showTooltip({
            tooltipTop: priceScale(midPrice(d)),
            tooltipLeft: blockScale(blockHeight(d)) / 2,
            tooltipData: d,
          });
        },
        onMouseLeave: () => {
          hideTooltip();
        },
      }),
      [blockScale, hideTooltip, priceScale, showTooltip],
    );

    const blockWidth = w / Number(endBlock - startBlock);

    return (
      <>
        <div className={className ?? 'size-full'} ref={parentRef}>
          <svg className='select-none' width={w} height={h}>
            <Group>
              <AxisBottom
                tickLabelProps={{
                  fill: 'white',
                  textAnchor: 'middle',
                }}
                tickStroke='rgba(255,255,255,0.25)'
                top={h - scaleMargin}
                scale={blockScale}
                numTicks={4}
                rangePadding={10}
              />
              <GridRows // price axis grid
                scale={priceScale}
                left={scaleMargin}
                width={w}
                stroke='white'
                strokeOpacity={0.1}
                numTicks={3}
              />
              <AxisLeft // price axis
                tickFormat={value => Number(value).toFixed(2)}
                tickLabelProps={{
                  fill: 'white',
                  textAnchor: 'end',
                }}
                left={scaleMargin}
                scale={priceScale}
                numTicks={3}
              />
              <Threshold
                // low-high area shading
                id='price-spread'
                curve={curveLinear}
                data={candles}
                x={(d: CandlestickData) => blockScale(blockHeight(d))}
                y0={(d: CandlestickData) => priceScale(lowPrice(d))}
                y1={(d: CandlestickData) => priceScale(highPrice(d))}
                clipAboveTo={0}
                clipBelowTo={h}
                belowAreaProps={{
                  fill: 'white',
                  fillOpacity: 0.1,
                }}
              />
              <LinePath
                // mid price line
                id='median-price'
                curve={curveLinear}
                data={candles}
                x={(d: CandlestickData) => blockScale(blockHeight(d))}
                y={(d: CandlestickData) => priceScale((openPrice(d) + closePrice(d)) * 0.5)}
                stroke='white'
                strokeOpacity={0.2}
                strokeWidth={2}
              />
              {
                // render a candle for every price record
                candles.map((d: CandlestickData) => {
                  const movementColor = priceMovementColor(d);
                  const open = openPrice(d);
                  const close = closePrice(d);
                  const useTooltipProps = useTooltip(d);

                  return (
                    <g key={d.height}>
                      <BoxPlot
                        valueScale={priceScale}
                        // data
                        min={lowPrice(d)}
                        max={highPrice(d)}
                        median={midPrice(d)}
                        firstQuartile={Math.min(open, close)}
                        thirdQuartile={Math.max(open, close)}
                        // box position and dimensions
                        left={blockScale(blockHeight(d)) - (blockWidth + 1) / 2}
                        boxWidth={blockWidth + 1}
                        // basic styles
                        fill={movementColor}
                        stroke={'rgba(255,255,255,0.5)'}
                        strokeWidth={1}
                        // compositional props
                        boxProps={{
                          ...useTooltipProps,
                          // box fill provides color
                          strokeWidth: 0,
                          stroke: movementColor,
                          // no stroke radius
                          rx: 0,
                          ry: 0,
                        }}
                        containerProps={useTooltipProps}
                        minProps={useTooltipProps}
                        maxProps={useTooltipProps}
                        medianProps={{ display: 'none' }}
                      />
                    </g>
                  );
                })
              }
            </Group>
          </svg>
        </div>
        {tooltipOpen && tooltipData && (
          <CandlesticksTooltip
            top={tooltipTop}
            left={tooltipLeft}
            data={tooltipData}
            getBlockDate={getBlockDate}
            endMetadata={endMetadata}
            startMetadata={startMetadata}
          />
        )}
      </>
    );
  },
);

export const CandlesticksTooltip = ({
  top,
  left,
  data,
  getBlockDate,
  endMetadata,
  startMetadata,
}: CandlestickTooltipProps) => {
  const [blockDate, setBlockDate] = useState<Date>();
  useEffect(() => {
    const ac = new AbortController();
    void getBlockDate(data.height, ac.signal).then(setBlockDate);
    return () => ac.abort('Abort tooltip date query');
  }, [data, getBlockDate]);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- TODO: justify non-null assertion
  const endBase = endMetadata.denomUnits.find(d => !d.exponent)!;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- TODO: justify non-null assertion
  const startBase = startMetadata.denomUnits.find(d => !d.exponent)!;
  return (
    <Tooltip
      unstyled={true}
      applyPositionStyle={true}
      top={top}
      left={left}
      className='absolute m-2 border border-solid border-light-brown bg-secondary p-2 font-mono text-xs opacity-80'
    >
      <div className='flex flex-row justify-between'>
        <div>
          <div>
            block {String(data.height)} ({blockDate?.toLocaleString()})
          </div>
          <div>
            Price of {endBase.denom} in {startBase.denom}
          </div>
        </div>
        {
          // if difference is more significant than 0.0001, show arrow
          Boolean(priceMovement(data) * 1000) && (
            <div>
              {priceMovement(data) > 0 ? (
                <ArrowUpRight className='text-green-500' size={32} />
              ) : (
                <ArrowDownRight className='text-red-500' size={32} />
              )}
            </div>
          )
        }
      </div>
      <div className='grid grid-flow-col grid-rows-2 gap-x-2 text-right'>
        <div>
          high: {Number(data.high).toFixed(4)} {startBase.denom}
        </div>
        <div>
          low: {Number(data.low).toFixed(4)} {startBase.denom}
        </div>
        <div>
          open: {Number(data.open).toFixed(4)} {startBase.denom}
        </div>
        <div>
          close: {Number(data.close).toFixed(4)} {startBase.denom}
        </div>
      </div>
      <div>{Number(data.directVolume)} direct trades</div>
      <div>{Number(data.swapVolume)} indirect trades</div>
    </Tooltip>
  );
};
