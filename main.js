import Highcharts from 'highcharts';
import HighchartsTreemap from 'highcharts/modules/treemap';
import {
    ChartColumn,
    ChartConfig,
    ChartModel,
    ChartToTSEvent,
    CustomChartContext,
    DataPointsArray,
    getChartContext,
    ColumnType,
    Query
} from '@thoughtspot/ts-chart-sdk';
import _ from 'lodash';

HighchartsTreemap(Highcharts);

// Helper function to extract data for columns
function getDataForColumn(column, dataArr) {
    const idx = _.findIndex(dataArr.columns, (colId) => column.id === colId);
    return _.map(dataArr.dataValue, (row) => row[idx]);
}

// Function to prepare the data model for the treemap
function getDataModel(chartModel) {
    const configDimensions = chartModel.config?.chartConfig?.[0].dimensions ?? [];
    const dataArr = chartModel.data?.[0].data ?? undefined;

    if (!dataArr) {
        console.error("No data available for the chart.");
        return { dataModel: [], top10: [] };
    }

    const xAxisColumns = configDimensions?.[0].columns ?? [];
    const yAxisColumns = configDimensions?.[1].columns ?? [];

    if (!xAxisColumns.length || !yAxisColumns.length || yAxisColumns.length < 2) {
        console.error("Invalid column configuration. Ensure the first column is an attribute and the next two are measures.");
        return { dataModel: [], top10: [] };
    }

    const totalValue = getDataForColumn(yAxisColumns[0], dataArr).reduce((sum, value) => sum + value, 0);

    const dataModel = dataArr?.dataValue.map((row, idx) => {
        const value = row[yAxisColumns[0].id];
        const lyValue = row[yAxisColumns[1]?.id] || value; // Fallback to current value if LY value is undefined
        const percentageChange = lyValue !== 0 ? ((value - lyValue) / lyValue) * 100 : 0;
        const percentageOfTotal = totalValue !== 0 ? (value / totalValue) * 100 : 0;

        return {
            name: row[xAxisColumns[0].id],
            value: value,
            lyValue: lyValue,
            colorValue: percentageChange,
            tooltipLabel: `<b>${row[xAxisColumns[0].id]}</b><br>Value: ${value}<br>LY Value: ${lyValue}<br>Change: ${percentageChange.toFixed(2)}%<br>% of Total: ${percentageOfTotal.toFixed(2)}%`,
            dataLabel: `${row[xAxisColumns[0].id]}<br>Value: ${value}<br>Change: ${percentageChange.toFixed(2)}%<br>% of Total: ${percentageOfTotal.toFixed(2)}%`
        };
    });

    // Sort the dataModel by value and pick the top 10
    const top10 = _.orderBy(dataModel, ['value'], ['desc']).slice(0, 10);

    // Log the data model for debugging
    console.log('DataModel:', dataModel);
    console.log('Top 10:', top10);

    return { dataModel, top10 };
}

// Function to render the chart
function render(ctx) {
    const chartModel = ctx.getChartModel();
    const { dataModel, top10 } = getDataModel(chartModel);

    if (!dataModel.length) {
        console.error('No valid data to render.');
        return;
    }

    try {
        Highcharts.chart('container', {
            colorAxis: {
                stops: [
                    [0, '#ff6666'],  // Red for the most negative change
                    [0.5, '#FFFFFF'], // Neutral color at zero change
                    [1, '#66cc66']   // Green for the most positive change
                ],
                min: -100,
                max: 100
            },
            series: [{
                type: 'treemap',
                layoutAlgorithm: 'squarified',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        const value = this.point.value;
                        const lyValue = this.point.lyValue;
                        const percentageChange = lyValue !== 0 ? ((value - lyValue) / lyValue) * 100 : 0;
                        const totalValue = this.series.data.reduce((sum, point) => sum + point.value, 0);
                        const percentageOfTotal = totalValue !== 0 ? (value / totalValue) * 100 : 0;

                        // Check if the current point is in the top 10
                        if (top10.some(point => point.name === this.point.name)) {
                            return `<b>${this.point.name}</b><br>Value: ${value}<br>Change: ${percentageChange.toFixed(2)}%<br>% of Total: ${percentageOfTotal.toFixed(2)}%`;
                        }
                        return null;
                    },
                    style: {
                        textOutline: false
                    }
                },
                data: dataModel
            }],
            title: {
                text: 'Highcharts Treemap'
            },
            tooltip: {
                formatter: function () {
                    return this.point.tooltipLabel;
                }
            }
        });
    } catch (e) {
        console.error('Render failed due to an error in Highcharts:', e);
        ctx.emitEvent(ChartToTSEvent.RenderError, {
            hasError: true,
            error: e
        });
    }
}

// Function to render the chart in the ThoughtSpot environment
const renderChart = async (ctx) => {
    try {
        ctx.emitEvent(ChartToTSEvent.RenderStart);
        render(ctx);
    } catch (e) {
        ctx.emitEvent(ChartToTSEvent.RenderError, {
            hasError: true,
            error: e
        });
    } finally {
        ctx.emitEvent(ChartToTSEvent.RenderComplete);
    }
};

// Initialize the chart context
(async () => {
    const ctx = await getChartContext({
        getDefaultChartConfig: (chartModel) => {
            const cols = chartModel.columns;
            const measureColumns = _.filter(cols, col => col.type === ColumnType.MEASURE);
            const attributeColumns = _.filter(cols, col => col.type === ColumnType.ATTRIBUTE);

            if (attributeColumns.length === 0 || measureColumns.length < 2) {
                console.error('Ensure that the first column is an attribute and the next two are measures.');
                return [];
            }

            return [{
                key: 'default',
                dimensions: [
                    { key: 'x', columns: [attributeColumns[0]] },
                    { key: 'y', columns: measureColumns.slice(0, 2) }
                ]
            }];
        },
        getQueriesFromChartConfig: (chartConfig) => chartConfig.map(config => ({
            queryColumns: _.flatMap(config.dimensions, dimension => dimension.columns)
        })),
        renderChart: (ctx) => renderChart(ctx)
    });

    renderChart(ctx);
})();
