<template lang="pug">
VuePlotly.myplot(
  :data="data"
  :layout="layout"
  :options="options"
  :id="id"
)
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { transpose } from 'mathjs'

import VuePlotly from '@/components/VuePlotly.vue'
import DashboardDataManager, { FilterDefinition } from '@/js/DashboardDataManager'
import { DataTable, FileSystemConfig, BG_COLOR_DASHBOARD, UI_FONT, Status } from '@/Globals'
import globalStore from '@/store'
import { buildCleanTitle } from './_allPanels'

export default defineComponent({
  name: 'HeatmapPanel',
  components: { VuePlotly },
  props: {
    fileSystemConfig: { type: Object as PropType<FileSystemConfig>, required: true },
    subfolder: { type: String, required: true },
    files: { type: Array, required: true },
    config: { type: Object as any, required: true },
    cardTitle: { type: String, required: true },
    cardId: String,
    datamanager: { type: Object as PropType<DashboardDataManager>, required: true },
    zoomed: Boolean,
  },
  data: () => {
    return {
      globalState: globalStore.state,
      // dataSet is either x,y or allRows[]
      dataSet: {} as { x?: any[]; y?: any[]; allRows?: DataTable },
      id: ('heatmap-' + Math.floor(1e12 * Math.random())) as any,
      YAMLrequirementsHeatmap: { dataset: '', y: '', columns: [] },
      layout: {
        margin: { t: 8, b: 50 },
        font: {
          color: '#444444',
          family: UI_FONT,
        },
        barmode: '',
        bargap: 0.08,
        xaxis: {
          autorange: true,
          title: '',
        },
        yaxis: {
          autorange: true,
          title: '',
        },
        legend: {
          x: 1,
          xanchor: 'right',
          y: 1,
        },
      } as any,
      data: [] as any[],
      options: {
        displaylogo: false,
        responsive: true,
        modeBarButtonsToRemove: [
          'pan2d',
          'zoom2d',
          'select2d',
          'lasso2d',
          'zoomIn2d',
          'zoomOut2d',
          'autoScale2d',
          'hoverClosestCartesian',
          'hoverCompareCartesian',
          'resetScale2d',
          'toggleSpikelines',
          'resetViewMapbox',
        ],
        toImageButtonOptions: {
          format: 'png', // one of png, svg, jpeg, webp
          filename: 'heatmap',
          width: 1200,
          height: 800,
          scale: 1.0, // Multiply title/legend/axis/canvas sizes by this factor
        },
      },
    }
  },
  async mounted() {
    this.updateTheme()
    this.checkWarningsAndErrors()
    this.dataSet = await this.loadData()

    if (Object.keys(this.dataSet).length) {
      this.updateChart()
      this.options.toImageButtonOptions.filename = buildCleanTitle(this.cardTitle, this.subfolder)
      this.$emit('dimension-resizer', { id: this.cardId, resizer: this.changeDimensions })
    }
    this.$emit('isLoaded')
  },
  beforeDestroy() {
    this.datamanager?.removeFilterListener(this.config, this.handleFilterChanged)
  },

  watch: {
    zoomed() {
      this.resizePlot()
    },
    'globalState.isDarkMode'() {
      this.updateTheme()
    },
  },
  methods: {
    changeDimensions(dimensions: { width: number; height: number }) {
      this.layout = Object.assign({}, this.layout, dimensions)
    },

    resizePlot() {
      var elements = document.getElementsByClassName('spinner-box')
      if (this.zoomed) {
        for (let element of elements) {
          if (element.clientHeight > 0) {
            this.layout.height = element.clientHeight
          }
        }
      } else {
        this.layout.height = 300
      }
    },

    updateTheme() {
      const colors = {
        paper_bgcolor: BG_COLOR_DASHBOARD[this.globalState.colorScheme],
        plot_bgcolor: BG_COLOR_DASHBOARD[this.globalState.colorScheme],
        font: { color: this.globalState.isDarkMode ? '#cccccc' : '#444444' },
      }
      this.layout = Object.assign({}, this.layout, colors)
    },

    handleFilterChanged() {
      if (!this.datamanager) return

      const { filteredRows } = this.datamanager.getFilteredDataset(this.config) as any

      if (!filteredRows || !filteredRows.length) {
        this.dataSet = { allRows: {} }
      } else {
        const allRows = {} as any

        const keys = Object.keys(filteredRows[0])
        keys.forEach(key => (allRows[key] = { name: key, values: [] as any }))

        filteredRows.forEach((row: any) => {
          keys.forEach(key => allRows[key].values.push(row[key]))
        })
        this.dataSet = { allRows }
      }

      this.updateChart()
    },

    async loadData() {
      if (!this.files.length) return {}

      try {
        this.validateYAML()
        let dataset = await this.datamanager.getDataset(this.config)

        // no filter? we are done
        if (!this.config.filters) return dataset

        // filter data before returning:
        this.datamanager.addFilterListener(this.config, this.handleFilterChanged)

        for (const [column, value] of Object.entries(this.config.filters)) {
          const filter: FilterDefinition = {
            dataset: this.config.dataset,
            column: column,
            value: value,
            range: Array.isArray(value),
          }
          this.datamanager.setFilter(filter)
        }
        // empty for now; filtered data will come back later via handleFilterChanged async.
        return { allRows: {} }
      } catch (e) {
        console.error('' + e)
      }
      return { allRows: {} }
    },

    validateYAML() {
      console.log('in heatmap validation')

      for (const key in this.YAMLrequirementsHeatmap) {
        if (key in this.config === false) {
          this.$store.commit('setStatus', {
            type: Status.ERROR,
            msg: `YAML file missing required key: ${key}`,
            desc: 'Check this.YAMLrequirementsXY for required keys',
          })
        }
      }
    },

    updateChart() {
      this.layout.xaxis.title = this.config.xAxisTitle || this.config.xAxisName || ''
      this.layout.yaxis.title = this.config.yAxisTitle || this.config.yAxisName || ''

      try {
        if (this.config.groupBy) this.updateChartWithGroupBy()
        else this.updateChartSimple()
      } catch (e) {
        const msg = '' + e
        this.$store.commit('setStatus', {
          type: Status.ERROR,
          msg,
          desc: 'Add a desription...',
        })
      }
    },

    updateChartWithGroupBy() {
      // tba
    },

    updateChartSimple() {
      var xaxis: any[] = []
      var matrix: any[] = []

      const allRows = this.dataSet.allRows || ({} as any)

      const columns = this.config.columns || this.config.usedCol || []
      if (!columns.length) return

      // Reads all the data of the y-axis.
      let yaxis = allRows[this.config.y].values

      // Reads all the data of the x-axis.
      for (const key of Object.keys(allRows)) {
        if (columns.includes(key)) {
          xaxis.push(key)
        }
      }

      // Converts all data to the matrix format of the heatmap
      let i = 0
      for (const column of this.config.columns) {
        matrix[i++] = allRows[column].values
      }

      if (!this.config.flipAxes) matrix = transpose(matrix)

      // Pushes the data into the chart
      this.data = [
        {
          x: this.config.flipAxes ? yaxis : xaxis,
          y: this.config.flipAxes ? xaxis : yaxis,
          z: matrix,
          colorscale: 'Viridis', // 'YlOrRed', // 'Hot',
          type: 'heatmap',
          automargin: true,
        },
      ]
    },

    // Check this plot for warnings and errors
    checkWarningsAndErrors() {
      var plotTitle = this.cardTitle
      // warnings
      // missing title
      if (plotTitle.length == 0) {
        this.$store.commit('setStatus', {
          type: Status.WARNING,
          msg: `The plot title is missing!`,
          desc: "Please add a plot title in the .yaml-file (title: 'Example title')",
        })
      }
      // errors
    },
  },
})
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.myplot {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
}
</style>
