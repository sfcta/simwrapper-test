<template lang="pug">
.width-panel
  .widgets
    .widget
        b-select.selector(expanded v-model="dataColumn")
          option(label="None" value="")
          optgroup(v-for="dataset in datasetChoices()"
                  :key="dataset" :label="dataset")
            option(v-for="column in numericColumnsInDataset(dataset)"
                  :value="`${dataset}/${column}`"
                  :label="column")

  .widgets
    .widget
      p Scaling
      b-field
        b-input(:disabled="!dataColumn" v-model="scaleFactor" placeholder="1.0")

  //- .widgets
  //-   .widget
  //-     p Transform
  //-     b-field.has-addons
  //-       p.control(v-for="transform of transforms" :key="transform")
  //-         b-button.is-small(
  //-           :disabled="!dataColumn"
  //-           :class="{'is-warning': dataColumn && transform==selectedTransform}"
  //-           @click="selectedTransform=transform"
  //-           :title="dataColumn ? 'Transforms occur after scaling':'Select a data field first'"
  //-           ) {{ transform }}

</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { VizLayerConfiguration, DataTable, DataType } from '@/Globals'

export type CircleRadiusDefinition = {
  dataset?: string
  columnName?: string
  scaleFactor?: number
}

export default defineComponent({
  name: 'CircleRadiusConfig',
  props: {
    vizConfiguration: { type: Object as PropType<VizLayerConfiguration>, required: true },
    datasets: { type: Object as PropType<{ [id: string]: DataTable }>, required: true },
  },
  data: () => {
    const transforms = ['none', 'sqrt', 'pow5']
    return {
      transforms,
      dataColumn: '',
      scaleFactor: '100',
      selectedTransform: transforms[0],
      datasetLabels: [] as string[],
    }
  },
  mounted() {
    this.datasetsAreLoaded()
    this.vizConfigChanged()
  },
  watch: {
    vizConfiguration() {
      this.vizConfigChanged()
    },
    datasets() {
      this.datasetsAreLoaded()
    },
    scaleFactor() {
      this.emitWidthSpecification()
    },
    dataColumn() {
      this.emitWidthSpecification()
    },
  },
  methods: {
    vizConfigChanged() {
      const config = this.vizConfiguration.display?.radius
      if (config?.columnName) {
        const selectedColumn = `${config.dataset}/${config.columnName}`
        this.dataColumn = selectedColumn
        this.datasetLabels = [...this.datasetLabels]
        this.scaleFactor = config.scaleFactor
      }
    },

    datasetsAreLoaded() {
      const datasetIds = Object.keys(this.datasets)
      this.datasetLabels = datasetIds
    },

    emitWidthSpecification() {
      if (!this.dataColumn) return

      const slash = this.dataColumn.indexOf('/')

      const dataset = this.dataColumn.substring(0, slash)
      const columnName = this.dataColumn.substring(slash + 1)

      const radius: CircleRadiusDefinition = {
        dataset,
        columnName,
        scaleFactor: parseFloat(this.scaleFactor),
      }

      setTimeout(() => this.$emit('update', { radius }), 50)
    },

    datasetChoices(): string[] {
      return this.datasetLabels.filter(label => label !== 'csvBase').reverse()
    },

    numericColumnsInDataset(datasetId: string): string[] {
      const dataset = this.datasets[datasetId]
      if (!dataset) return []
      const allColumns = Object.keys(dataset).filter(
        colName => dataset[colName].type !== DataType.LOOKUP
      )

      return allColumns
    },
  },
})
</script>

<style scoped lang="scss">
@import '@/styles.scss';
.width-panel {
  padding-right: 0rem;
}

.widgets {
  display: flex;
  margin-bottom: 0.5rem;

  p {
    margin-top: 5px;
    font-size: 1rem;
    margin-right: 1rem;
  }
}

.widget {
  flex: 1;
  margin-right: 0.75rem;
}

.selector {
  margin-top: 0.75rem;
  overflow-x: auto;
  max-width: 100%;
}
</style>
