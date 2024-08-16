import { ChartToTSEvent, ColumnType, getChartContext } from '@thoughtspot/ts-chart-sdk';
import _ from 'lodash';
import numeral from 'numeral';

// Function to calculate color gradient
const colorGradient = (value) => {
  if (value < -2) return '#ff6666';  // Darker red for high negative
  if (value < -1) return '#ff9999';  // Lighter red
  if (value < 0) return '#ffcccc';   // Lightest red
  if (value < 1) return '#ccffcc';   // Lightest green
  if (value < 2) return '#99ff99';   // Lighter green
  return '#66cc66';  // Darker green for high positive
};

// Function to render the heatmap
function renderHeatmap(categories) {
  const container = document.getElementById('heatmap');
  container.innerHTML = '';
  
  categories.forEach((category, index) => {
    const div = document.createElement('div');
    div.className = 'heatmap-cell';
    div.style.backgroundColor = colorGradient(category.change);

    if (index < 10) {
      // Display full metrics for top 10 categories
      div.innerHTML = `
        <div class="category-name">${category.name}</div>
        <div class="category-value">${numeral(category.value).format('$0,0.0a')}</div>
        <div class="category-change">${category.change}% vs LY</div>
        <div class="category-total">${category.total}% of Total</div>
      `;
    } else {
      // Only display category name for other categories
      div.innerHTML = `
        <div class="category-name">${category.name}</div>
      `;
    }
    
    // Add tooltip for all categories
    div.title = `
      ${category.name}
      Value: ${numeral(category.value).format('$0,0.0a')}
      Change: ${category.change}% vs LY
      Total: ${category.total}% of Total
    `;
    
    container.appendChild(div);
  });
}

// Function to calculate percentage change and percentage of total
function calculateMetrics(dataArr, chartModel) {
  const grossMarginIdx = _.findIndex(chartModel.columns, col => col.name === 'Gross Margin');
  const grossMarginLYIdx = _.findIndex(chartModel.columns, col => col.name === 'Gross Margin LY');

  // Calculate total gross margin
  const totalValue = _.sumBy(dataArr, row => row[grossMarginIdx]);

  // Map through the data to calculate metrics for each category
  return dataArr.map(row => {
    const name = row[_.findIndex(chartModel.columns, col => col.name === 'Category')];
    const value = row[grossMarginIdx];
    const valueLY = row[grossMarginLYIdx];

    // Calculate percentage change vs LY
    const change = valueLY ? ((value - valueLY) / valueLY * 100).toFixed(2) : 0;

    // Calculate percentage of total
    const total = ((value / totalValue) * 100).toFixed(2);

    return { name, value, change, total };
  });
}

async function render(ctx) {
  const chartModel = await ctx.getChartModel();
  
  const dataArr = chartModel.data?.[0]?.data ?? [];

  // Calculate metrics
  const categories = calculateMetrics(dataArr, chartModel);

  // Render heatmap with the calculated metrics
  renderHeatmap(categories);
}

const renderChart = async (ctx) => {
  try {
    ctx.emitEvent(ChartToTSEvent.RenderStart);
    await render(ctx);
  } catch (e) {
    ctx.emitEvent(ChartToTSEvent.RenderError, { hasError: true, error: e });
  } finally {
    ctx.emitEvent(ChartToTSEvent.RenderComplete);
  }
};

(async () => {
  const ctx = await getChartContext({
    renderChart,
    chartConfigEditorDefinition: [
      {
        key: 'column',
        label: 'Custom Column',
        descriptionText: 'This chart accepts attributes and measures. Category for name, Gross Margin for values, and Gross Margin LY for Last Year’s values.',
        columnSections: [
          { key: 'Category', label: 'Category', allowAttributeColumns: true, allowMeasureColumns: false },
          { key: 'Gross Margin', label: 'Gross Margin', allowAttributeColumns: false, allowMeasureColumns: true },
          { key: 'Gross Margin LY', label: 'Gross Margin LY', allowAttributeColumns: false, allowMeasureColumns: true },
        ],
      },
    ],
  });

  renderChart(ctx);
})();
