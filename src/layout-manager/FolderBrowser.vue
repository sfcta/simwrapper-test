<template lang="pug">
.folder-browser

  //- show network errors
  .stripe.details(v-if="myState.errorStatus")
   .vessel
    .badnews(v-html="myState.errorStatus")

  //- main content
  .stripe.details(v-else)
   .vessel

    //- these are sections defined by viz-summary.yml etc
    .curated-sections

      b.up-link: a(@click="$emit('up')") ^ UP

      //- this is the content of readme.md, if it exists
      .readme-header.markdown
        .curate-content.markdown(
          v-if="myState.readme"
          v-html="myState.readme"
        )

      //- file system folders
      h3.curate-heading(v-if="myState.folders.length")  {{ $t('Folders') }}

      .curate-content(v-if="myState.folders.length")
        .folder-table
          .folder(:class="{fade: myState.isLoading}"
                  :key="folder.name"
                  v-for="folder in myState.folders"
                  @click="openOutputFolder(folder)")
            p
              i.fa.fa-folder-open
              | &nbsp;{{ cleanName(folder) }}

      //- MAPS: thumbnails of each viz map here
      .section-maps(v-if="Object.keys(vizMaps).length")
        h3.curate-heading {{ $t('Maps')}}
        .curate-content
          .viz-table
            .viz-grid-item(v-for="[index, viz] of Object.entries(vizMaps)" :key="index"
                      @click="clickedVisualization(index)")

              .viz-frame
                p.v-title: b {{ viz.title }}
                p.v-filename {{ viz.config }}
                p.v-plugin(:style="getTabColor(viz.component)") {{ viz.component || 'dashboard' }}
                component.viz-frame-component(
                      v-show="false"
                      :is="viz.component"
                      :root="myState.svnProject.slug"
                      :subfolder="myState.subfolder"
                      :yamlConfig="viz.config"
                      :thumbnail="true"
                      :fileApi="myState.svnRoot"
                      :style="{'pointer-events': 'none'}"
                      @title="updateTitle(index, $event)")

      //- IMAGES here
      .section-images(v-if="Object.keys(vizImages).length")
        h3.curate-heading {{ $t('Images')}}
        .curate-content
          .viz-image-table
            .viz-image-grid-item(v-for="[index, viz] of Object.entries(vizImages)" :key="index"
                      @click="clickedVisualization(index)")

              .viz-image-frame
                component.viz-image-frame-component(
                      :is="viz.component"
                      :root="myState.svnProject.slug"
                      :subfolder="myState.subfolder"
                      :yamlConfig="viz.config"
                      :thumbnail="true"
                      :fileApi="myState.svnRoot"
                      :style="{'pointer-events': 'auto'}"
                      @title="updateTitle(index, $event)")
                p {{ viz.title }}

      //- FILES: individual links to files in this folder
      //- this is DISABLED for Chrome API for now, because we
      //- can't download those files via regular URL
      .files-section(v-if="myState?.svnProject?.baseURL")
        h3.curate-heading(v-if="myState.files.length") {{$t('Files')}}

        .curate-content(v-if="myState.files.length")
          .file-table
            .file(v-for="file in myState.files" :key="file"
              :class="{fade: myState.isLoading}"
            )
              a(:href="`${myState.svnProject.baseURL}/${myState.subfolder}/${file}`") {{ cleanName(file) }}

</template>

<script lang="ts">
const i18n = {
  messages: {
    en: {
      Maps: 'Maps',
      Images: 'Images',
      Analysis: 'Analysis',
      Files: 'Files',
      Folders: 'Folders',
      Topsheet: 'Topsheet',
    },
    de: {
      Maps: 'Karten',
      Images: 'Bilder',
      Analysis: 'Ergebnisse',
      Files: 'Dateien',
      Folders: 'Ordner',
      Topsheet: 'Topsheet',
    },
  },
}

interface VizEntry {
  component: string
  config: string
  title: string
}

interface IMyState {
  errorStatus: string
  folders: string[]
  files: string[]
  isLoading: boolean
  readme: string
  svnProject: FileSystemConfig | null
  svnRoot?: HTTPFileSystem
  subfolder: string
  summary: boolean
  vizes: VizEntry[]
}

import { defineComponent } from 'vue'
import type { PropType } from 'vue'

import markdown from 'markdown-it'
import mediumZoom from 'medium-zoom'
import micromatch from 'micromatch'
import yaml from 'yaml'

import globalStore from '@/store'
import plugins from '@/plugins/pluginRegistry'
import HTTPFileSystem from '@/js/HTTPFileSystem'
import { BreadCrumb, FileSystemConfig, YamlConfigs } from '@/Globals'
import TopsheetsFinder from '@/components/TopsheetsFinder/TopsheetsFinder.vue'

const tabColors = {
  // blank means dashboard:
  '': '#118860',
  // others are kebab-case:
  'aggregate-od': '#E98B52',
  'vehicle-anim': '#330033',
  'x-y-t': '#583270',
  'carrier-viewer': '#c97A2C',
  events: '#4400ff',
  hexagons: '#900564',
  'area-map': '#c94264',
  network: '#894654',
  sankey: '#D8A672',
  summary: '#2EA95B',
  transit: '#3B6FE4',
} as any

const allComponents = Object.assign({ TopsheetsFinder }, plugins)

export default defineComponent({
  name: 'FolderBrowser',
  i18n,
  components: allComponents,
  props: {
    root: { type: String, required: true },
    allConfigFiles: { type: Object as PropType<YamlConfigs>, required: true },
    xsubfolder: String,
  },
  data: () => {
    return {
      globalState: globalStore.state,
      summaryYamlFilename: 'viz-summary.yml',
      mdRenderer: new markdown({
        html: true,
        linkify: true,
        typographer: true,
      }),
      myState: {
        errorStatus: '',
        folders: [],
        files: [],
        isLoading: false,
        readme: '',
        svnProject: null,
        svnRoot: undefined,
        subfolder: '',
        vizes: [],
        summary: false,
      } as IMyState,
    }
  },
  computed: {
    vizImages(): any {
      const images: { [index: number]: any } = {}
      for (let i = 0; i < this.myState.vizes.length; i++) {
        if (this.myState.vizes[i].component === 'image-view') {
          images[i] = this.myState.vizes[i]
        }
      }
      return images
    },

    vizMaps(): any {
      const maps: { [index: number]: any } = {}
      for (let i = 0; i < this.myState.vizes.length; i++) {
        if (this.myState.vizes[i].component !== 'image-view') {
          maps[i] = this.myState.vizes[i]
        }
      }
      return maps
    },
  },
  methods: {
    cleanName(text: string) {
      return decodeURIComponent(text)
    },

    getFileSystem(name: string) {
      const svnProject: FileSystemConfig[] = globalStore.state.svnProjects.filter(
        (a: FileSystemConfig) => a.slug === name
      )

      if (svnProject.length === 0) {
        console.log('no such project')
        throw Error
      }

      return svnProject[0]
    },

    generateBreadcrumbs() {
      if (!this.myState.svnProject) return []

      const crumbs = [
        {
          label: 'SimWrapper',
          url: '/',
        },
        {
          label: this.myState.svnProject.name,
          url: '/' + this.myState.svnProject.slug,
        },
      ]

      const subfolders = this.myState.subfolder.split('/')
      let buildFolder = '/'
      for (const folder of subfolders) {
        if (!folder) continue

        buildFolder += folder + '/'
        crumbs.push({
          label: folder,
          url: '/' + this.myState.svnProject.slug + buildFolder,
        })
      }

      // save them!
      globalStore.commit('setBreadCrumbs', crumbs)
      return crumbs
    },

    clickedVisualization(vizNumber: number) {
      const viz = this.myState.vizes[vizNumber]

      // special case: images don't click thru
      if (viz.component === 'image-view') return

      if (!this.myState.svnProject) return

      const props = {
        root: this.myState.svnProject.slug,
        xsubfolder: this.myState.subfolder,
        subfolder: this.myState.subfolder,
        yamlConfig: viz.config,
        thumbnail: false,
      }

      this.$emit('navigate', { component: viz.component, props })
    },

    updateTitle(viz: number, title: string) {
      this.myState.vizes[viz].title = title
    },

    async showReadme() {
      this.myState.readme = ''
      const readme = 'readme.md'
      if (this.myState.files.map(f => f.toLocaleLowerCase()).indexOf(readme) > -1) {
        if (!this.myState.svnRoot) return
        const text = await this.myState.svnRoot.getFileText(this.myState.subfolder + '/' + readme)
        this.myState.readme = this.mdRenderer.render(text)
      }
    },

    buildShowEverythingView() {
      // loop on each viz type
      for (const viz of this.globalState.visualizationTypes.values()) {
        // filter based on file matching
        const matches = micromatch(this.myState.files, viz.filePatterns)
        for (const file of matches) {
          // add thumbnail for each matching file
          this.myState.vizes.push({ component: viz.kebabName, config: file, title: '..' })
        }
      }
    },

    // Curate the view, if viz-summary.yml exists
    async buildCuratedSummaryView() {
      if (!this.myState.svnRoot) return

      const summaryYaml = yaml.parse(
        await this.myState.svnRoot.getFileText(
          this.myState.subfolder + '/' + this.summaryYamlFilename
        )
      )

      // loop on each curated viz type
      for (const vizName of summaryYaml.plugins) {
        // load plugin user asked for
        const viz = this.globalState.visualizationTypes.get(vizName)
        if (!viz) continue

        // curate file list if provided for this plugin
        if (summaryYaml[viz.kebabName]) {
          for (const pattern of summaryYaml[viz.kebabName]) {
            // add thumbnail for each matching file
            const matches = await this.findMatchingFiles(pattern)
            for (const file of matches) {
              this.myState.vizes.push({ component: viz.kebabName, config: file, title: file })
            }
          }
        } else {
          // filter based on file matching
          const matches = micromatch(this.myState.files, viz.filePatterns)
          for (const file of matches) {
            // add thumbnail for each matching file
            this.myState.vizes.push({ component: viz.kebabName, config: file, title: '..' })
          }
        }
      }
    },

    async findMatchingFiles(glob: string): Promise<string[]> {
      // first see if file itself is in this folder
      if (this.myState.files.indexOf(glob) > -1) return [glob]

      // return globs in this folder
      const matches = micromatch(this.myState.files, glob)
      if (matches.length) return matches

      // search subfolder for glob, for now just one subfolder down
      if (!this.myState.svnRoot) return []
      try {
        const split = glob.split('/')
        const subsubfolder = this.myState.subfolder + '/' + split[0]
        console.log(subsubfolder)
        const contents = await this.myState.svnRoot.getDirectory(subsubfolder)
        const matches = micromatch(contents.files, split[1])
        return matches.map(f => split[0] + '/' + f)
      } catch (e) {
        // oh well, we tried
      }

      return []
    },

    async fetchFolderContents() {
      if (!this.myState.svnRoot) return []

      this.myState.isLoading = true
      this.myState.errorStatus = ''
      this.myState.files = []

      try {
        const folderContents = await this.myState.svnRoot.getDirectory(this.myState.subfolder)

        // hide dot folders
        const folders = folderContents.dirs.filter(f => !f.startsWith('.')).sort()
        const files = folderContents.files.filter(f => !f.startsWith('.')).sort()

        // Also show any project-level viz thumbnails from other folders
        // (but, ensure that files in this folder supercede any project viz files
        // with the same name)
        const mergedFilesAndVizes = Object.assign({}, this.allConfigFiles.vizes)
        for (const file of files) {
          mergedFilesAndVizes[file] = file
        }

        const allVizes = Object.values(mergedFilesAndVizes)

        this.myState.errorStatus = ''
        this.myState.folders = folders
        this.myState.files = allVizes
      } catch (err) {
        // Bad things happened! Tell user
        const e = err as any
        console.log('BAD PAGE')
        console.log({ eeee: e })

        this.myState.folders = []
        this.myState.files = []

        this.myState.errorStatus = '<h3>'
        if (e.status) this.myState.errorStatus += `${e.status} `
        if (e.statusText) this.myState.errorStatus += `${e.statusText}`
        if (this.myState.errorStatus === '<h3>') this.myState.errorStatus += 'Error'
        this.myState.errorStatus += `</h3>`
        if (e.url) this.myState.errorStatus += `<p>${e.url}</p>`
        if (e.message) this.myState.errorStatus += `<p>${e.message}</p>`
        if (this.myState.errorStatus === '<h3>Error</h3>') this.myState.errorStatus = '' + e

        if (this.myState.svnProject) {
          this.myState.errorStatus += `<p><i>${this.myState.svnProject.baseURL}${this.myState.subfolder}</i></p>`
        }

        // maybe it failed because password?
        if (this.myState.svnProject && this.myState.svnProject.needPassword && e.status === 401) {
          globalStore.commit('requestLogin', this.myState.svnProject.slug)
        }
      } finally {
        this.myState.isLoading = false
      }
    },

    openOutputFolder(folder: string) {
      if (this.myState.isLoading) return
      if (!this.myState.svnProject) return

      const target =
        folder === '..'
          ? this.myState.subfolder.substring(0, this.myState.subfolder.lastIndexOf('/'))
          : this.myState.subfolder + '/' + folder

      const props = {
        root: this.myState.svnProject.slug,
        xsubfolder: target,
      }

      // if we are at top of hierarchy, jump to splashpage
      if (!target && !this.myState.subfolder) {
        this.$emit('navigate', { component: 'SplashPage', props: {} })
      } else {
        this.$emit('navigate', { component: 'TabbedDashboardView', props })
      }
    },

    getTabColor(kebabName: string) {
      const color = tabColors[kebabName] || '#8778BB'
      return { backgroundColor: color }
    },

    updateRoute() {
      const svnProject = this.getFileSystem(this.root)

      this.myState.svnProject = svnProject
      this.myState.subfolder = this.xsubfolder || ''
      this.myState.readme = ''

      if (!this.myState.svnProject) return
      this.myState.svnRoot = new HTTPFileSystem(this.myState.svnProject)

      this.generateBreadcrumbs()

      // this happens async
      this.fetchFolderContents()
    },
  },
  watch: {
    'globalState.colorScheme'() {
      // medium-zoom freaks out if color theme is swapped.
      // so let's reload images just in case.
      this.fetchFolderContents()
    },
    xsubfolder() {
      this.updateRoute()
    },
    allConfigFiles() {
      this.updateRoute()
    },
    'globalState.authAttempts'() {
      console.log('AUTH CHANGED - Reload')
      this.updateRoute()
    },
    async 'myState.files'() {
      // clear visualizations
      this.myState.vizes = []
      if (this.myState.files.length === 0) return

      this.showReadme()

      this.myState.summary = this.myState.files.indexOf(this.summaryYamlFilename) !== -1

      if (this.myState.summary) {
        await this.buildCuratedSummaryView()
      } else {
        this.buildShowEverythingView()
      }

      // make sure page is rendered before we attach zoom semantics
      await this.$nextTick()
      mediumZoom('.medium-zoom', {
        background: '#444450',
      })
    },
  },
  mounted() {
    this.updateRoute()
  },
})
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.vessel {
  margin: 0 auto;
  padding: 0rem 0rem 2rem 0rem;
  max-width: $dashboardWidth + 3;
}

.white {
  background-color: var(--bgBold);
}

.cream {
  background-color: var(--bgCream);
}

h2 {
  font-size: 1.8rem;
}

h3,
h4 {
  margin-top: 2rem;
  margin-bottom: 0.5rem;
}

.badnews {
  border-left: 3rem solid #af232f;
  margin: 0rem 0rem;
  padding: 0.5rem 0rem;
  background-color: #ffc;
  color: $matsimBlue;
}

.viz-table {
  display: flex;
  flex-direction: column;
  list-style: none;
}

.viz-grid-item {
  z-index: 1;
  // text-align: center;
  margin: 4px 0;
  padding: 0 0;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  vertical-align: top;
  background-color: var(--bgBrowser);
  // border: var(--borderThin);
  border-radius: 5px;
}

.viz-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  z-index: 1;
  flex: 1;
  overflow: hidden;
  padding: 5px 0 0 5px;
  border-radius: 3px;
  p {
    margin: 0 0 0 0;
    line-height: 1rem;
    padding: 0 0;
    color: var(--text);
    word-wrap: break-word;
    /* Required for text-overflow to do anything */
    // text-overflow: ellipsis;
    // white-space: nowrap;
    // overflow: hidden;
  }
}

.viz-frame:hover {
  // box-shadow: var(--shadowMode);
  background-color: var(--bgHover);
  border-radius: 5px;
  transition: background-color 0.02s ease-in-out;
}

.viz-frame-component {
  background-color: var(--bgPanel);
}

.logo {
  margin-left: auto;
}

.folder-table {
  display: grid;
  row-gap: 0rem;
  column-gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  list-style: none;
  margin-bottom: 0px;
  padding-left: 0px;
}

.folder {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  background-color: var(--bgBrowser);
  margin: 0.25rem 0rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  word-wrap: break-word;
}

.folder:hover {
  background-color: var(--bgHover);
  // box-shadow: 0 2px 4px 0 rgba(0, 0, 0, 0.08), 0 3px 10px 0 rgba(0, 0, 0, 0.08);
  transition: background-color 0.1s ease-in-out;
}

.project-bar {
  display: flex;
  margin-bottom: 1rem;
  padding: 2rem 0 0 0;
  z-index: 10000;
}

.project-bar p {
  margin-top: -0.25rem;
}

.fade {
  opacity: 0.4;
  pointer-events: none;
}

.file-table {
  display: grid;
  row-gap: 0rem;
  column-gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

.file {
  word-break: break-all;
  line-height: 1rem;
  margin-bottom: 0.5rem;
}

.markdown {
  padding: 1rem 0rem;
}

.curated-sections {
  padding-top: 0rem;
  display: flex;
  flex-direction: column;
}

.curate-heading {
  padding: 0rem 0rem;
  margin: 0rem 0rem;
}

.readme-header {
  font-size: 1.1rem;
  padding-bottom: 1rem;
}

h3.curate-heading {
  font-size: 1.8rem;
  font-weight: bold;
  color: var(--textFancy);
  padding-top: 0.5rem;
  margin-top: 0rem;
}

.curate-content {
  padding: 1rem 0rem;
  margin: 0rem 0rem;
}

.viz-image-table {
  display: grid;
  grid-gap: 2rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  list-style: none;
}

.viz-image-grid-item {
  z-index: 1;
  text-align: center;
  margin: 0 0;
  padding: 0 0;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  vertical-align: top;
  background-color: var(--bgBold);
  border: var(--borderThin);
  border-radius: 16px;
}

.viz-image-frame {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: $thumbnailHeight;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  p {
    margin: auto 0 0 0;
    background-color: var(--bgDashboard);
    font-size: 1rem;
    font-weight: bold;
    line-height: 1.2rem;
    padding: 1rem 0.5rem;
    color: var(--text);
    word-wrap: break-word;
    /* Required for text-overflow to do anything */
    // text-overflow: ellipsis;
    // white-space: nowrap;
    // overflow: hidden;
  }
}

.viz-image-frame:hover {
  box-shadow: var(--shadowMode);
  transition: box-shadow 0.1s ease-in-out;
}

.viz-image-frame-component {
  background-color: var(--bgPanel);
}

.folder-browser {
  background-color: var(--bgMapPanel);
  padding: 0 3rem;
}

// p.v-title {
//   // font-size: 1rem;
// }

p.v-filename {
  margin: 5px 0;
}

p.v-plugin {
  text-align: right;
  text-transform: uppercase;
  margin-left: auto;
  color: white;
  background-color: var(--bgCream3);
  padding: 2px 3px;
  border-radius: 0 0 4px 0;
}
</style>
