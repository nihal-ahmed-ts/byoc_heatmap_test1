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
import * as d3 from 'd3';

// Helper function to extract data for columns
function getDataForColumn(column, dataArr) {
    const idx = _.findIndex(dataArr.columns, (colId) => column.id === colId);
    return _.map(dataArr.dataValue, (row) => row[idx]);
}

// Function to prepare the data model for the treemap
function getDataModel(chartModel) {
    if (!chartModel || !chartModel.data || !chartModel.data[0].data) {
        console.error("No data available for the chart.");
        return { dataModel: [], top10: [] };
    }

    const configDimensions = chartModel.config?.chartConfig?.[0].dimensions ?? [];
    const dataArr = chartModel.data?.[0].data ?? undefined;

    if (!dataArr) {
        console.error("No data array available.");
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

// Function to render the treemap using D3.js
function render(ctx) {
    const chartModel = ctx.getChartModel();
    if (!chartModel) {
        console.error('Chart model is undefined');
        return;
    }

    const { dataModel } = getDataModel(chartModel);

    if (!dataModel.length) {
        console.error('No valid data to render.');
        return;
    }

    const container = document.getElementById('container');
    if (!container) {
        console.error('Container element not found');
        return;
    }

    // Clear previous chart
    d3.select('#container').html('');

    // Set up the dimensions
    const width = container.offsetWidth;
    const height = 600;

    // Create a root node for the treemap
    const root = d3.hierarchy({ children: dataModel })
        .sum(d => d.value)
        .sort((a, b) => b.value - a.value);

    // Create the treemap layout
    d3.treemap()
        .size([width, height])
        .padding(2)
        .round(true)(root);

    // Select the container and append divs for each node
    const nodes = d3.select('#container')
        .selectAll('.node')
        .data(root.leaves())
        .enter()
        .append('div')
        .attr('class', 'node')
        .style('left', d => `${d.x0}px`)
        .style('top', d => `${d.y0}px`)
        .style('width', d => `${d.x1 - d.x0}px`)
        .style('height', d => `${d.y1 - d.y0}px`)
        .style('background', d => d3.interpolateBlues(d.data.colorValue / 100))
        .style('position', 'absolute')
        .on('mouseover', function (event, d) {
            d3.select('#tooltip')
                .style('visibility', 'visible')
                .html(d.data.tooltipLabel)
                .style('left', `${event.pageX + 5}px`)
                .style('top', `${event.pageY + 5}px`);
        })
        .on('mousemove', function (event) {
            d3.select('#tooltip')
                .style('left', `${event.pageX + 5}px`)
                .style('top', `${event.pageY + 5}px`);
        })
        .on('mouseout', function () {
            d3.select('#tooltip').style('visibility', 'hidden');
        });

    // Append text labels to each node
    nodes.append('text')
        .attr('class', 'label')
        .style('font-size', '12px')
        .style('color', '#fff')
        .text(d => d.data.name);
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
            const cols = chartModel.columns || [];
            const measureColumns = _.filter(cols, col => col.type === ColumnType.MEASURE);
            const attributeColumns = _.filter(cols, col => col.type === ColumnType.ATTRIBUTE);

            if (attributeColumns.length === 0 || measureColumns.length < 2) {
                console.error('Ensure that the first column is an attribute and the next two are measures.');
                return []; // Return an empty configuration if invalid
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

// Example function to handle possible timeout or fetch errors
const fetchData = async () => {
    try {
        const response = await fetch('your-data-endpoint');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        // Handle timeout or retry logic here
        return null;
    }
};
