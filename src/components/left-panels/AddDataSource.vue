<template lang="pug">
.add-data
  .add
    .markdown(v-html="notes")
    .flex-row
      p.flex1: b Label
      b-input.flex5(size="is-small" placeholder="e.g. server1" maxlength="32" v-model="labelField")
    .flex-row
      p.flex1: b URL
      b-input.flex5(size="is-small" placeholder="http://localhost:8001" maxlength="512" v-model="urlField")
    .flex-row
      p.flex1: b Note
      b-input.flex5(size="is-small" placeholder="optional" maxlength="255" v-model="noteField")
    .flex-row
      p.flex1 &nbsp;
      b-button.is-primary(
        size="is-small"
        :disabled="!isValidURL"
        :type="isValidURL ? '' : 'is-outlined'"
        @click="addURL"
      ) Add Data URL

</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import MarkdownIt from 'markdown-it'

import globalStore from '@/store'

const mdAddNotes = `
Add a local shortcut for any URL-based resource.
SimWrapper requires several server settings, including:

- Open access (no login)
- File and directory listings
-  CORS "Access-Control-Allow-Origin"
`

export default defineComponent({
  name: 'AddDataSource',
  props: {},
  data: () => {
    return {
      labelField: '',
      urlField: '',
      noteField: '',
      notes: '',
      mdParser: new MarkdownIt(),
    }
  },
  mounted() {
    this.notes = this.mdParser.render(mdAddNotes)
  },
  watch: {
    labelField() {
      this.fixField()
    },
  },
  computed: {
    isValidURL() {
      if (!this.labelField) return false
      if (!this.urlField) return false
      if (!this.urlField.startsWith('http')) return false
      return true
    },
  },
  methods: {
    addURL() {
      this.fixField()
      console.log('Adding', this.labelField, this.urlField)

      const KEY = 'projectShortcuts'
      try {
        let existingRoot = localStorage.getItem(KEY) || ('{}' as any)

        let roots = JSON.parse(existingRoot)

        roots[this.labelField] = {
          name: `${this.labelField}`,
          slug: `${this.labelField}`,
          description: this.noteField,
          baseURL: this.urlField,
        }

        console.log('NEW ROOTS', roots)
        localStorage.setItem(KEY, JSON.stringify(roots))
        globalStore.commit('setURLShortcuts', roots)
      } catch (e) {
        // you failed
        console.error('' + e)
      }
    },

    fixField() {
      this.labelField = this.labelField.toLowerCase().replaceAll(/[^a-z\-0-9@]*/g, '')
    },
  },
})
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.add {
  gap: 0.25rem;
  margin: 0.5rem 0.25rem 0rem 0;
  color: var(--text);

  b-field {
    color: white;
  }
}

.flex-row {
  width: 100%;
  margin-bottom: 4px;
}
.flex1 {
  text-align: right;
  margin: auto 0.5rem;
}

.markdown {
  margin-bottom: 1rem;
  line-height: 1.3rem;
}

b-button {
  text-align: right;
}

@media only screen and (max-width: 640px) {
}
</style>
