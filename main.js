import {
    ChartColumn,
    ChartConfig,
    ChartModel,
    ChartSdkCustomStylingConfig,
    ChartToTSEvent,
    ColumnType,
    CustomChartContext,
    DataPointsArray,
    dateFormatter,
    getChartContext,
    isDateColumn,
    isDateNumColumn,
    PointVal,
    Query,
    ValidationResponse,
    VisualPropEditorDefinition,
    VisualProps,
} from '@thoughtspot/ts-chart-sdk';
import { ChartConfigEditorDefinition } from '@thoughtspot/ts-chart-sdk/src';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import _ from 'lodash';

Chart.register(ChartDataLabels);

const availableColor = ['#66cc66', '#99ff99', '#ccffcc', '#ffcccc', '#ff9999', '#ff6666'];

const visualPropKeyMap = {
    0: 'color',
    1: 'accordion.Color2',
    2: 'accordion.datalabels',
};

function getDataForColumn(column, dataArr) {
    const idx = _.findIndex(dataArr.columns, (colId) => column.id === colId);
    return _.map(dataArr.dataValue, (row) => {
        const colValue = row[idx];
        if (isDateColumn(column) || isDateNumColumn(column)) {
            return dateFormatter(colValue, column);
        }
        return colValue;
    });
}

function getColumnDataModel(configDimensions, dataArr, type, visualProps, customStyleConfig) {
    const xAxisColumns = configDimensions?.[0].columns ?? [];
    const yAxisColumns = configDimensions?.[1].columns ?? [];

    return {
        getLabels: () => getDataForColumn(xAxisColumns[0], dataArr),
        getDatasets: () =>
            _.map(yAxisColumns, (col, idx) => ({
                label: col.name,
                data: getDataForColumn(col, dataArr),
                yAxisID: `${type}-y${idx.toString()}`,
                type: `${type}`,
                backgroundColor:
                    customStyleConfig?.chartColorPalettes.length &&
                    customStyleConfig?.chartColorPalettes[0].colors.length > 0
                        ? customStyleConfig?.chartColorPalettes[0].colors
                        : _.get(visualProps, visualPropKeyMap?.[idx], availableColor[idx]),
                borderColor: _.get(visualProps, visualPropKeyMap?.[idx], availableColor[idx]),
                datalabels: {
                    anchor: 'end',
                },
            })),
        getScales: () =>
            _.reduce(yAxisColumns, (obj, _val, idx) => {
                obj[`${type}-y${idx.toString()}`] = {
                    grid: { display: true },
                    position: idx === 0 ? 'left' : 'right',
                    title: { display: true, text: _val.name, font: { size: 30, family: 'Custom font' } },
                };
                return obj;
            }, {}),
        getPointDetails: (xPos, yPos) => [
            {
                columnId: xAxisColumns[0].id,
                value: getDataForColumn(xAxisColumns[0], dataArr)[xPos],
            },
            {
                columnId: yAxisColumns[yPos].id,
                value: getDataForColumn(yAxisColumns[yPos], dataArr)[xPos],
            },
        ],
    };
}

function getDataModel(chartModel, customStyleConfig) {
    return getColumnDataModel(
        chartModel.config?.chartConfig?.[0].dimensions ?? [],
        chartModel.data?.[0].data ?? [],
        'bar',
        chartModel.visualProps,
        customStyleConfig
    );
}

function render(ctx) {
    const chartModel = ctx.getChartModel();
    const appConfig = ctx.getAppConfig();

    const dataModel = getDataModel(chartModel, appConfig?.styleConfig);
    if (!dataModel) {
        return;
    }

    try {
        const canvas = document.getElementById('heatmapChart');
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        const totalValue = dataModel.getLabels().reduce((acc, curr) => acc + curr, 0);
        const top10Categories = dataModel.getLabels().slice(0, 10);

        new Chart(canvas, {
            type: 'matrix',
            data: {
                datasets: [
                    {
                        label: 'Selected KPI',
                        data: dataModel.getDatasets().map((category, index) => ({
                            x: index % 10,
                            y: Math.floor(index / 10),
                            v: category.change,
                            categoryName: category.name,
                            value: category.value,
                            totalPercentage: category.totalPercentage,
                            change: category.change,
                        })),
                        backgroundColor: ctx => {
                            const value = ctx.raw.v;
                            return value < -2 ? '#ff6666' : value < -1 ? '#ff9999' : value < 0 ? '#ffcccc' : value < 1 ? '#ccffcc' : value < 2 ? '#99ff99' : '#66cc66';
                        },
                        width: () => 50,
                        height: () => 50,
                    },
                ],
            },
            options: {
                tooltips: {
                    callbacks: {
                        label: tooltipItem => {
                            const data = tooltipItem.dataset.data[tooltipItem.index];
                            return [
                                `Category: ${data.categoryName}`,
                                `Value: $${data.value}M`,
                                `Change vs LY: ${data.change}%`,
                                `Total: ${data.totalPercentage}%`,
                            ];
                        },
                    },
                },
                plugins: {
                    datalabels: {
                        display: ctx => top10Categories.some(c => c.name === ctx.raw.categoryName),
                        color: '#fff',
                        font: { weight: 'bold' },
                        formatter: (value, ctx) => {
                            const category = ctx.dataset.data[ctx.dataIndex];
                            return `${category.categoryName}\n$${category.value}M\n${category.change}% vs LY\n${category.totalPercentage}% of Total`;
                        },
                    },
                },
            },
        });
    } catch (e) {
        console.error('Render failed', e);
        throw e;
    }
}

const renderChart = async (ctx) => {
    try {
        ctx.emitEvent(ChartToTSEvent.RenderStart);
        render(ctx);
    } catch (e) {
        ctx.emitEvent(ChartToTSEvent.RenderError, { hasError: true, error: e });
    } finally {
        ctx.emitEvent(ChartToTSEvent.RenderComplete);
    }
};

(async () => {
    const ctx = await getChartContext({
        getDefaultChartConfig: chartModel => {
            const measureColumns = _.filter(chartModel.columns, col => col.type === ColumnType.MEASURE);
            const attributeColumns = _.filter(chartModel.columns, col => col.type === ColumnType.ATTRIBUTE);

            return [
                {
                    key: 'column',
                    dimensions: [
                        { key: 'x', columns: [attributeColumns[0]] },
                        { key: 'y', columns: measureColumns.slice(0, 2) },
                    ],
                },
            ];
        },
        getQueriesFromChartConfig: chartConfig => {
            return chartConfig.map(config =>
                _.reduce(config.dimensions, (acc, dimension) => ({
                    queryColumns: [...acc.queryColumns, ...dimension.columns],
                }), { queryColumns: [] })
            );
        },
        renderChart: ctx => renderChart(ctx),
    });

    renderChart(ctx);
})();
