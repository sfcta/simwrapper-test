<template lang="pug">
link-volumes.deck-map(
  :root="fileSystemConfig.slug"
  :subfolder="subfolder"
  :config="config"
  :thumbnail="false"
  :datamanager="datamanager"
  @isLoaded="isLoaded"
)

</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

import { FileSystemConfig } from '@/Globals'
import LinkVolumes from '@/plugins/links-gl/NetworkLinks.vue'
import DashboardDataManager from '@/js/DashboardDataManager'

export default defineComponent({
  name: 'LinksPanel',
  components: { LinkVolumes },
  props: {
    fileSystemConfig: { type: Object as PropType<FileSystemConfig>, required: true },
    subfolder: { type: String, required: true },
    files: { type: Array, required: true },
    config: { type: Object, required: true },
    datamanager: Object as PropType<DashboardDataManager>,
  },
  mounted() {
    // this.$emit('isLoaded')
  },
  methods: {
    isLoaded() {
      this.$emit('isLoaded')
    },
  },
})
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.deck-map {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
}

@media only screen and (max-width: 640px) {
}
</style>
