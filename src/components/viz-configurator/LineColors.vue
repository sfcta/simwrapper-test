<template lang="pug">
.color-ramp-picker
  .widgets
    .widget
        b-select.selector(expanded v-model="dataColumn")
          option(label="No lines" value="^")
          option(label="Single color" value="@")
          optgroup(v-for="dataset in datasetChoices()"
                  :key="dataset" :label="dataset")
            option(v-for="column in columnsInDataset(dataset)" :value="`${dataset}/${column}`" :label="column")

  .colorbar.single(v-show="dataColumn=='@'")
    .single-color(
      v-for="swatch of simpleColors" :key="swatch"
      :style="{backgroundColor: `${swatch}`}"
      :class="{active: selectedSingleColor == swatch }"
      @click="clickedSingleColor(swatch)")

  .more(v-show="dataColumn && dataColumn.length >= 2")
    .widgets
      .widget
        p Steps
        b-input(v-model="steps"
            placeholder="Number"
            type="number"
            min="2"
            max="15")

      .widget
        p Reverse
        b-checkbox.hello(v-model="flip")

    .color-ramp(v-for="choice of colorChoices" :key="choice.ramp"
      @click="pickColor(choice)"
      :class="{active: choice === selectedColor}"
    )
      .colorbar
        .swatch(
          v-for="swatch,i of buildColors(choice)" :key="i"
          :style="{backgroundColor: `${swatch}`}"
        ): p &nbsp;


</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

import * as d3sc from 'd3-scale-chromatic'
import * as d3color from 'd3-color'

import { VizLayerConfiguration, DataTable, DataType } from '@/Globals'
import globalStore from '@/store'

const d3 = Object.assign({}, d3sc, d3color) as any

enum style {
  categorical,
  diverging,
  sequential,
}

interface Ramp {
  ramp: string
  style: style
  reverse?: boolean
  steps?: number
  breakpoints?: string
}

export interface LineColorDefinition {
  diff?: string
  diffDatasets?: string[]
  relative?: boolean
  dataset: string
  columnName: string
  colorRamp?: Ramp
  fixedColors: string[]
}

const ALL_COLOR_RAMPS = [
  { ramp: 'Viridis', style: style.sequential, reverse: true }, // , reverse: true },
  { ramp: 'Plasma', style: style.sequential, reverse: true }, // , reverse: true },
  { ramp: 'Blues', style: style.sequential }, // , reverse: true },
  { ramp: 'Greens', style: style.sequential }, // , reverse: true },
  { ramp: 'Purples', style: style.sequential }, // , reverse: true },
  { ramp: 'Oranges', style: style.sequential }, // , reverse: true },
  { ramp: 'RdBu', style: style.diverging, reverse: true },
  { ramp: 'PRGn', style: style.diverging, reverse: true },
  { ramp: 'Tableau10', style: style.categorical }, // , reverse: true },
  { ramp: 'Paired', style: style.categorical }, // , reverse: true },
  // { ramp: 'PuOr', style: style.diverging }, // , reverse: true },
]

export default defineComponent({
  name: 'LineColorsConfig',
  props: {
    vizConfiguration: { type: Object as PropType<VizLayerConfiguration>, required: true },
    datasets: { type: Object as PropType<{ [id: string]: DataTable }>, required: true },
  },
  data: () => {
    return {
      globalState: globalStore.state,
      dataColumn: '@',
      datasetLabels: [] as string[],
      diffChoices: [] as any[],
      diffDatasets: [] as string[],
      diffRelative: false,
      diffUISelection: '',
      flip: false,
      isCurrentlyDiffMode: false,
      isFirstDataset: true,
      selectedColor: {} as Ramp,
      selectedSingleColor: '',
      steps: '9',
      useHardCodedColors: false,
    }
  },
  computed: {
    simpleColors(): any {
      return this.buildColors({ ramp: 'Tableau10', style: style.categorical }, 10)
    },
    colorChoices() {
      if (!this.diffDatasets || this.diffDatasets.length) {
        return ALL_COLOR_RAMPS.filter(ramp => ramp.style == style.diverging)
      }
      return ALL_COLOR_RAMPS
    },
  },
  mounted() {
    this.datasetLabels = Object.keys(this.vizConfiguration.datasets)
    this.datasetsAreLoaded()

    if (this.vizConfiguration.display?.lineColor?.fixedColors) this.useHardCodedColors = true

    this.vizConfigChanged()
  },
  watch: {
    vizConfiguration() {
      this.vizConfigChanged()
    },
    datasets() {
      this.datasetsAreLoaded()
    },
    diffUISelection() {
      this.diffSelectionChanged()
    },
    dataColumn() {
      this.emitColorSpecification()
    },
    diffDatasets() {
      this.emitColorSpecification()
    },
    diffRelative() {
      this.emitColorSpecification()
    },
    flip() {
      this.emitColorSpecification()
    },
    'globalState.isDarkMode'() {
      this.emitColorSpecification()
    },
    selectedColor() {
      this.emitColorSpecification()
    },
    steps() {
      this.emitColorSpecification()
    },
  },
  methods: {
    vizConfigChanged() {
      const config = this.vizConfiguration.display?.lineColor

      this.setupDiffMode(config)

      if (config?.columnName) {
        const selectedColumn = this.diffDatasets.length
          ? `${this.diffDatasets[0]}/${config.columnName}`
          : `${config.dataset}/${config.columnName}`

        this.dataColumn = selectedColumn
        this.datasetLabels = [...this.datasetLabels]
        if (config.colorRamp) {
          let colorChoice =
            this.colorChoices.find(f => f.ramp == config.colorRamp.ramp) || this.colorChoices[0]
          this.selectedColor = colorChoice
          this.steps = config.colorRamp.steps
          this.flip = !!config.colorRamp.reverse
        }
      } else if (config?.fixedColors) {
        this.clickedSingleColor(config.fixedColors[0])
      }
    },
    setupDiffMode(config: LineColorDefinition) {
      if (!config?.diff) return

      let diffPieces: string[] = []

      if (config.diff.indexOf(' - ') > -1) {
        diffPieces = config.diff.split(' - ').map(p => p.trim())
      } else {
        diffPieces = config.diff.split('-').map(p => p.trim())
        if (diffPieces.length > 2) throw Error('Ambiguous diff, use " - " to separate terms')
      }

      this.diffDatasets = diffPieces
      this.diffRelative = !!config.relative
      this.diffUISelection = `${diffPieces[0]} - ${diffPieces[1]}`
    },

    datasetsAreLoaded() {
      const datasetIds = Object.keys(this.datasets)
      this.datasetLabels = datasetIds
      this.updateDiffLabels()
    },

    updateDiffLabels() {
      const choices = []

      choices.push(['No', ''])
      if (this.datasetLabels.length <= 1) return

      // create all combinations of x-y and y-x
      const nonShapefileDatasets = this.datasetLabels.slice(1)
      let combos = nonShapefileDatasets.flatMap((v, i) =>
        nonShapefileDatasets.slice(i + 1).map(w => v + ' - ' + w)
      )
      combos.forEach(combo => choices.push([combo, combo]))

      nonShapefileDatasets.reverse()
      combos = nonShapefileDatasets.flatMap((v, i) =>
        nonShapefileDatasets.slice(i + 1).map(w => v + ' - ' + w)
      )
      combos.forEach(combo => choices.push([combo, combo]))

      this.diffChoices = choices
    },

    diffSelectionChanged() {
      if (this.diffUISelection) {
        const pieces = this.diffUISelection.split(' - ')
        this.diffDatasets = pieces
        // pick a diverging color ramp if we don't have one yet
        if (!this.isCurrentlyDiffMode) this.selectedColor = this.colorChoices[0]
      } else {
        // pick a nondiverging color ramp if we just turned diffmode off
        if (this.isCurrentlyDiffMode) this.selectedColor = ALL_COLOR_RAMPS[0]
        this.diffDatasets = []
        this.diffRelative = false
      }
      this.isCurrentlyDiffMode = !!this.diffUISelection
    },

    emitColorSpecification() {
      // no answer
      if (!this.dataColumn) return

      // no lines
      if (this.dataColumn == '^') {
        this.clickedSingleColor('')
        return
      }

      const slash = this.dataColumn.indexOf('/')

      // single color
      if (slash === -1) {
        if (!this.selectedSingleColor) this.selectedSingleColor = this.simpleColors[0]
        this.clickedSingleColor(this.selectedSingleColor)
        return
      }

      // based on data
      const dataset = this.dataColumn.substring(0, slash)
      const columnName = this.dataColumn.substring(slash + 1)
      const steps = parseInt(this.steps)

      // Define the actual colors in the ramp.
      // Use hard-coded colors if they are present (in fixedColors) -- first load only.
      const fixedColors = this.useHardCodedColors
        ? this.vizConfiguration.display?.lineColor?.fixedColors.slice()
        : this.buildColors(this.selectedColor, steps)

      // this.useHardCodedColors = false

      const lineColor = {
        dataset,
        columnName,
        fixedColors,
        colorRamp: {
          ramp: this.selectedColor.ramp,
          style: this.selectedColor.style,
          reverse: this.flip,
          steps,
        },
      } as any

      if (this.diffDatasets.length) lineColor.diffDatasets = this.diffDatasets
      if (this.diffRelative) lineColor.relative = true

      if (this.vizConfiguration.display?.lineColor?.colorRamp?.breakpoints) {
        lineColor.colorRamp.breakpoints =
          this.vizConfiguration.display?.lineColor?.colorRamp?.breakpoints
      }
      setTimeout(() => this.$emit('update', { lineColor }), 50)
    },

    clickedSingleColor(swatch: string) {
      this.selectedSingleColor = swatch
      const lineColor: LineColorDefinition = {
        fixedColors: [this.selectedSingleColor],
        dataset: '',
        columnName: '',
      }

      // the link viewer is on main thread so lets make
      // sure user gets some visual feedback
      setTimeout(() => this.$emit('update', { lineColor }), 50)
    },

    datasetChoices(): string[] {
      return this.datasetLabels.filter(label => label !== 'csvBase').reverse()
    },

    columnsInDataset(datasetId: string): string[] {
      const dataset = this.datasets[datasetId]
      if (!dataset) return []
      const allColumns = Object.keys(dataset).filter(
        colName => dataset[colName].type !== DataType.LOOKUP
      )

      return allColumns
    },

    pickColor(colorRamp: Ramp) {
      this.selectedColor = colorRamp
    },

    buildColors(scale: Ramp, count?: number): string[] {
      let colors = [...this.ramp(scale, count || parseInt(this.steps))]

      // many reasons to flip the colorscale:
      // (1) the scale preset; (2) the checkbox (3) dark mode
      let reverse = !!scale.reverse
      if (this.flip) reverse = !reverse
      if (reverse) colors = colors.reverse()

      // only flip in dark mode if it's a sequential scale
      // if (scale.style === style.sequential && this.globalState.isDarkMode) {
      //   colors = colors.reverse()
      // }

      return colors
    },

    ramp(scale: Ramp, n: number): string[] {
      let colors
      // let dark

      // categorical
      if (scale.style === style.categorical) {
        const categories = d3[`scheme${scale.ramp}`]
        return categories.slice(0, n)
      }

      // sequential and diverging
      if (d3[`scheme${scale.ramp}`] && d3[`scheme${scale.ramp}`][n]) {
        colors = d3[`scheme${scale.ramp}`][n]
        // dark = d3.lab(colors[0]).l < 50
      } else {
        try {
          const interpolate = d3[`interpolate${scale.ramp}`]
          colors = []
          // dark = d3.lab(interpolate(0)).l < 50
          for (let i = 0; i < n; ++i) {
            colors.push(d3.rgb(interpolate(i / (n - 1))).hex())
          }
        } catch (e) {
          // some ramps cannot be interpolated, give the
          // highest one instead.
          return this.ramp(scale, n - 1)
        }
      }

      // fix center color if diverging: pale grey
      if (scale.style === style.diverging && n % 2 === 1) {
        colors[Math.floor(n / 2)] = globalStore.state.isDarkMode ? '#282828' : '#e4e4e4'
      }

      return colors
    },
  },
})
</script>

<style scoped lang="scss">
@import '@/styles.scss';
.color-ramp-picker {
  padding-right: 0rem;
}

.widgets {
  display: flex;
  margin-bottom: 0.5rem;

  p {
    margin-top: 0.25rem;
    font-size: 1rem;
    margin-right: 1rem;
  }
}

.selector {
  margin-top: 0.75rem;
  overflow-x: auto;
  max-width: 100%;
}

.widget {
  flex: 1;
  margin-right: 0.75rem;
  display: flex;
  flex-direction: column;
}

.hello {
  margin-top: 0.5rem;
}

.color-ramp {
  display: flex;
  flex-direction: column;
  padding: 1px 1px;
  border-radius: 3px;
  margin-right: 0.75rem;
  border: 3px solid #00000000;
}

.color-ramp.active {
  border: 3px solid #6361dd;
}

.colorbar {
  display: flex;
  flex-direction: row;
  height: 12px;
}

.color-ramp:hover {
  background-color: #99c;
}

.swatch {
  flex: 1;
}

.single {
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
  height: 18px;
}

.single-color {
  margin-right: 1px;
  width: 18px;
  border: 3px solid #e2e5f2;
  border-radius: 2px;
}

.single-color:hover {
  border-color: #99c;
  cursor: pointer;
}
.single-color.active {
  border-color: black;
}
</style>
