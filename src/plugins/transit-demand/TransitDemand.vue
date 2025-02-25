<template lang="pug">
.transit-viz(:class="{'hide-thumbnail': !thumbnail}")
  .map-container(:class="{'hide-thumbnail': !thumbnail }")
    div.map-styles(:id="mapID")
      .stop-marker(v-for="stop in stopMarkers" :key="stop.i"
        :style="{transform: 'translate(-50%,-50%) rotate('+stop.bearing+'deg)', left: stop.xy.x + 'px', top: stop.xy.y+'px'}"
      )

    legend-box.legend(v-if="!thumbnail"
      :rows="legendRows"
    )

  zoom-buttons(v-if="!thumbnail")
  //- drawing-tool(v-if="!thumbnail")

  collapsible-panel.left-side(v-if="!thumbnail"
    :darkMode="isDarkMode"
    :locked="true"
    direction="left")

    .panel-items
      //- .panel-item(v-if="vizDetails.title")
      //-   h3 {{ vizDetails.title }}
      //-   p {{ vizDetails.description }}

      .route-list(v-if="routesOnLink.length > 0")
        .route(v-for="route in routesOnLink"
            :key="route.uniqueRouteID"
            :class="{highlightedRoute: selectedRoute && route.id === selectedRoute.id}"
            @click="showRouteDetails(route.id)")
          .route-title {{route.id}}
          .detailed-route-data
            .col
              p: b {{route.departures}} departures
              p First: {{route.firstDeparture}}
              p Last: {{route.lastDeparture}}
            .col(v-if="route.passengersAtArrival")
              p: b {{ route.passengersAtArrival }} passengers
              p {{ route.totalVehicleCapacity }} capacity

  .control-panel(v-if="!thumbnail"
    :class="{'is-dashboard': config !== undefined }"
  )

    .panel-item
      p.control-label {{  $t('metrics') }}:
      .metric-buttons
        button.button.is-small.metric-button(
          v-for="metric,i in metrics" :key="metric.field"
          :style="{'color': activeMetric===metric.field ? 'white' : buttonColors[i], 'border': `1px solid ${buttonColors[i]}`, 'border-right': `0.4rem solid ${buttonColors[i]}`,'border-radius': '4px', 'background-color': activeMetric===metric.field ? buttonColors[i] : isDarkMode ? '#333':'white'}"
          @click="handleClickedMetric(metric)") {{ $i18n.locale === 'de' ? metric.name_de : metric.name_en }}

  .status-corner(v-if="!thumbnail && loadingText")
    p {{ loadingText }}

</template>

<script lang="ts">
const i18n = {
  messages: {
    en: { metrics: 'Metrics', viewer: 'Transit Network' },
    de: { metrics: 'Metrics', viewer: 'ÖV Netzwerk' },
  },
}

import { defineComponent } from 'vue'
import type { PropType } from 'vue'

import * as turf from '@turf/turf'
import colormap from 'colormap'
import crossfilter from 'crossfilter2'
import maplibregl, { GeoJSONSource, LngLatBoundsLike, LngLatLike, Popup } from 'maplibre-gl'
import Papaparse from 'papaparse'
import yaml from 'yaml'

import globalStore from '@/store'
import CollapsiblePanel from '@/components/CollapsiblePanel.vue'
import HTTPFileSystem from '@/js/HTTPFileSystem'
import LeftDataPanel from '@/components/LeftDataPanel.vue'
import { Network, NetworkInputs, NetworkNode, TransitLine, RouteDetails } from './Interfaces'
import NewXmlFetcher from '@/workers/NewXmlFetcher.worker?worker'
import TransitSupplyWorker from './TransitSupplyHelper.worker?worker'
import LegendBox from './LegendBox.vue'
import DrawingTool from '@/components/DrawingTool/DrawingTool.vue'
import ZoomButtons from '@/components/ZoomButtons.vue'

import { FileSystem, FileSystemConfig, ColorScheme, VisualizationPlugin } from '@/Globals'

import GzipWorker from '@/workers/GzipFetcher.worker?worker'

const DEFAULT_PROJECTION = 'EPSG:31468' // 31468' // 2048'

const COLOR_CATEGORIES = 10
const SHOW_STOPS_AT_ZOOM_LEVEL = 11

class Departure {
  public total: number = 0
  public routes: Set<string> = new Set()
}

const MyComponent = defineComponent({
  name: 'TransitViewer',
  i18n,
  components: { CollapsiblePanel, LeftDataPanel, LegendBox, DrawingTool, ZoomButtons },
  props: {
    root: { type: String, required: true },
    subfolder: { type: String, required: true },
    yamlConfig: String,
    config: { type: Object as any },
    thumbnail: Boolean,
  },
  data() {
    const metrics = [{ field: 'departures', name_en: 'Departures', name_de: 'Abfahrten' }]

    return {
      mapPopup: new Popup({
        closeButton: false,
        closeOnClick: false,
      }),
      buttonColors: ['#5E8AAE', '#BF7230', '#269367', '#9C439C'],
      metrics: metrics,
      activeMetric: metrics[0].field as any,
      vizDetails: {
        transitSchedule: '',
        network: '',
        demand: '',
        projection: '',
        title: '',
        description: '',
      },
      myState: {
        subfolder: '',
        yamlConfig: '',
        thumbnail: true,
      },
      isDarkMode: globalStore.state.isDarkMode,
      isMapMoving: false,
      loadingText: 'MATSim Transit Inspector',
      mymap: null as any,
      mapID: `map-id-${Math.floor(1e12 * Math.random())}` as any,

      projection: DEFAULT_PROJECTION,
      routesOnLink: [] as any[],
      selectedRoute: {} as any,
      stopMarkers: [] as any[],

      _attachedRouteLayers: [] as string[],
      _departures: {} as { [linkID: string]: Departure },
      _linkData: null as any,
      _mapExtentXYXY: null as any,
      _maximum: -Infinity,
      _network: {} as Network,
      _routeData: {} as { [index: string]: RouteDetails },
      _stopFacilities: {} as { [index: string]: NetworkNode },
      _transitLines: {} as { [index: string]: TransitLine },
      _roadFetcher: null as any,
      _transitFetcher: null as any,
      _transitHelper: null as any,
      _transitLinks: null as any,
      _geoTransitLinks: null as any,

      resolvers: {} as { [id: number]: any },
      resolverId: 0,
      xmlWorker: null as null | Worker,
      cfDemand: null as crossfilter.Crossfilter<any> | null,
      cfDemandLink: null as crossfilter.Dimension<any, any> | null,
      hoverWait: false,
    }
  },
  computed: {
    fileApi(): HTTPFileSystem {
      return new HTTPFileSystem(this.fileSystem)
    },

    fileSystem(): FileSystemConfig {
      const svnProject: FileSystemConfig[] = this.$store.state.svnProjects.filter(
        (a: FileSystemConfig) => a.slug === this.root
      )
      if (svnProject.length === 0) {
        console.log('no such project')
        throw Error
      }
      return svnProject[0]
    },

    legendRows(): string[][] {
      return [
        ['#a03919', 'Rail'],
        ['#448', 'Bus'],
      ]
    },
  },

  watch: {
    '$store.state.resizeEvents'() {
      if (this.mymap) this.mymap.resize()
    },

    '$store.state.viewState'({ bearing, longitude, latitude, zoom, pitch }: any) {
      // ignore my own farts; they smell like roses
      if (!this.mymap || this.isMapMoving) {
        this.isMapMoving = false
        return
      }

      // sometimes closing a view returns a null map, ignore it!
      if (!zoom) return

      this.mymap.off('move', this.handleMapMotion)

      this.mymap.jumpTo({
        bearing,
        zoom,
        center: [longitude, latitude],
        pitch,
      })

      this.mymap.on('move', this.handleMapMotion)

      if (this.stopMarkers.length > 0) this.showTransitStops()
    },

    '$store.state.colorScheme'() {
      this.isDarkMode = this.$store.state.colorScheme === ColorScheme.DarkMode
      if (!this.mymap) return

      this.removeAttachedRoutes()

      this.mymap.setStyle(globalStore.getters.mapStyle)

      this.mymap.on('style.load', () => {
        if (this._geoTransitLinks) this.addTransitToMap(this._geoTransitLinks)
        this.highlightAllAttachedRoutes()
        if (this.selectedRoute) this.showTransitRoute(this.selectedRoute.id)
      })
    },
  },

  methods: {
    async getVizDetails() {
      // are we in a dashboard?
      if (this.config) {
        this.vizDetails = Object.assign({}, this.config)
        return
      }

      // if a YAML file was passed in, just use it
      if (this.myState.yamlConfig?.endsWith('yaml') || this.myState.yamlConfig?.endsWith('yml')) {
        this.loadYamlConfig()
        return
      }

      // Build the config based on folder contents
      const title = this.myState.yamlConfig.substring(
        0,
        15 + this.myState.yamlConfig.indexOf('transitSchedule')
      )

      this.vizDetails = {
        transitSchedule: this.myState.yamlConfig,
        network: '',
        title,
        description: '',
        demand: '',
        projection: '',
      }

      this.$emit('title', title)
    },

    async prepareView() {
      const { files } = await this.fileApi.getDirectory(this.myState.subfolder)

      // Road network: first try the most obvious network filename:
      let network = this.myState.yamlConfig.replaceAll('transitSchedule', 'network')

      // if the obvious network file doesn't exist, just grab... the first network file:
      if (files.indexOf(network) == -1) {
        const allNetworks = files.filter(f => f.endsWith('network.xml.gz'))
        if (allNetworks.length) network = allNetworks[0]
        else {
          this.loadingText = 'No road network found.'
          network = ''
        }
      }

      // Departures: use them if we are in an output folder (and they exist)
      let demandFiles = [] as string[]
      if (this.myState.yamlConfig.indexOf('output_transitSchedule') > -1) {
        demandFiles = files.filter(f => f.endsWith('pt_stop2stop_departures.csv.gz'))
      }

      // Coordinates:
      const projection = await this.guessProjection(files)
      console.log(projection)

      // Save everything
      this.vizDetails.network = network
      this.vizDetails.projection = projection
      if (demandFiles.length) this.vizDetails.demand = demandFiles[0]

      this.projection = this.vizDetails.projection
    },

    async guessProjection(files: string[]): Promise<string> {
      // 0. If it's in config, use it
      if (this.config?.projection) return this.config.projection

      // 1. if we have it in storage already, use it
      const storagePath = `${this.root}/${this.subfolder}`
      let savedConfig = localStorage.getItem(storagePath) as any

      const goodEPSG = /EPSG:.\d/

      if (savedConfig) {
        try {
          const config = JSON.parse(savedConfig)

          if (goodEPSG.test(config.networkProjection)) {
            return config.networkProjection
          } else {
            savedConfig = {}
          }
        } catch (e) {
          console.error('bad saved config in storage', savedConfig)
          savedConfig = {}
          // fail! ok try something else
        }
      }

      // 2. try to get it from config
      const outputConfigs = files.filter(
        f => f.indexOf('.output_config.xml') > -1 || f.indexOf('.output_config_reduced.xml') > -1
      )
      if (outputConfigs.length && this.fileSystem) {
        // console.log('trying to find CRS in', outputConfigs[0])

        for (const xmlConfigFileName of outputConfigs) {
          try {
            const configXML: any = await this.fetchXML({
              worker: null,
              slug: this.fileSystem.slug,
              filePath: this.myState.subfolder + '/' + xmlConfigFileName,
            })

            const global = configXML.config.module.filter((f: any) => f.$name === 'global')[0]
            const crs = global.param.filter((p: any) => p.$name === 'coordinateSystem')[0]

            const crsValue = crs.$value

            // save it
            savedConfig = savedConfig || {}
            savedConfig.networkProjection = crsValue
            localStorage.setItem(storagePath, JSON.stringify(savedConfig))
            return crsValue
          } catch (e) {
            console.warn('Failed parsing', xmlConfigFileName)
          }
        }
      }

      // 3. ask the user
      let entry = prompt('Need coordinate EPSG number:', '') || ''

      // if user cancelled, give up
      if (!entry) return ''
      // if user gave bad answer, try again
      if (isNaN(parseInt(entry, 10)) && !goodEPSG.test(entry)) return this.guessProjection(files)

      // hopefully user gave a good EPSG number
      if (!entry.startsWith('EPSG:')) entry = 'EPSG:' + entry

      const networkProjection = entry
      localStorage.setItem(storagePath, JSON.stringify({ networkProjection }))
      return networkProjection
    },

    async loadYamlConfig() {
      // first get config
      try {
        // might be a project config:
        const filename =
          this.myState.yamlConfig.indexOf('/') > -1
            ? this.myState.yamlConfig
            : this.myState.subfolder + '/' + this.myState.yamlConfig

        const text = await this.fileApi.getFileText(filename)
        this.vizDetails = yaml.parse(text)
      } catch (e) {
        // maybe it failed because password?
        const err = e as any
        if (this.fileSystem && this.fileSystem.needPassword && err.status === 401) {
          this.$store.commit('requestLogin', this.fileSystem.slug)
        }
      }

      const t = this.vizDetails.title ? this.vizDetails.title : 'Transit Ridership'
      this.$emit('title', t)

      this.projection = this.vizDetails.projection
    },

    isMobile() {
      const w = window
      const d = document
      const e = d.documentElement
      const g = d.getElementsByTagName('body')[0]
      const x = w.innerWidth || e.clientWidth || g.clientWidth
      const y = w.innerHeight || e.clientHeight || g.clientHeight
      return x < 640
    },

    setupMap() {
      try {
        this.mymap = new maplibregl.Map({
          bearing: 0,
          container: this.mapID,
          logoPosition: 'bottom-left',
          style: globalStore.getters.mapStyle,
          pitch: 0,
        })

        const extent = localStorage.getItem(this.$route.fullPath + '-bounds')

        if (extent) {
          const lnglat = JSON.parse(extent)

          const mFac = this.isMobile() ? 0 : 1
          const padding = { top: 50 * mFac, bottom: 50 * mFac, right: 50 * mFac, left: 50 * mFac }

          this.mymap.fitBounds(lnglat, {
            animate: false,
            padding,
          })
        }
        // Start doing stuff AFTER the MapBox library has fully initialized
        this.mymap.on('load', this.mapIsReady)
        this.mymap.on('move', this.handleMapMotion)
        this.mymap.on('click', this.handleEmptyClick)

        this.mymap.keyboard.disable() // so arrow keys don't pan
      } catch (e) {
        console.error({ e })
        // no worries
      }
    },

    handleClickedMetric(metric: { field: string }) {
      console.log('transit metric:', metric.field)

      this.activeMetric = metric.field

      let widthExpression: any = 3

      switch (metric.field) {
        case 'departures':
          widthExpression = ['max', 2, ['*', 0.03, ['get', 'departures']]]
          break

        case 'pax':
          widthExpression = ['max', 2, ['*', 0.003, ['get', 'pax']]]
          break

        case 'loadfac':
          widthExpression = ['max', 2, ['*', 200, ['get', 'loadfac']]]
          break
      }

      this.mymap.setPaintProperty('transit-link', 'line-width', widthExpression)
    },

    handleMapMotion() {
      const mapCamera = {
        longitude: this.mymap.getCenter().lng,
        latitude: this.mymap.getCenter().lat,
        bearing: this.mymap.getBearing(),
        zoom: this.mymap.getZoom(),
        pitch: this.mymap.getPitch(),
      }

      if (!this.isMapMoving) this.$store.commit('setMapCamera', mapCamera)
      this.isMapMoving = true

      if (this.stopMarkers.length > 0) this.showTransitStops()
    },

    handleEmptyClick(e: mapboxgl.MapMouseEvent) {
      this.removeStopMarkers()
      this.removeSelectedRoute()
      this.removeAttachedRoutes()
      this.routesOnLink = []
    },

    showRouteDetails(routeID: string) {
      if (!routeID && !this.selectedRoute) return

      console.log({ routeID })

      if (routeID) this.showTransitRoute(routeID)
      else this.showTransitRoute(this.selectedRoute.id)

      this.showTransitStops()
    },

    async mapIsReady() {
      const networks = await this.loadNetworks()
      // console.log({ networks })
      if (networks) this.processInputs(networks)

      // TODO remove for now until we research whether
      // this causes a memory leak:
      // this.setupKeyListeners()
    },

    setupKeyListeners() {
      window.addEventListener('keyup', event => {
        if (event.keyCode === 27) {
          // ESC
          this.pressedEscape()
        }
      })
      window.addEventListener('keydown', event => {
        if (event.keyCode === 38) {
          this.pressedArrowKey(-1) // UP
        }
        if (event.keyCode === 40) {
          this.pressedArrowKey(+1) // DOWN
        }
      })
    },

    fetchXML(props: { worker: any; slug: string; filePath: string; options?: any }) {
      if (props.worker) props.worker.terminate()

      let xmlWorker = props.worker || ({} as any)
      {
        xmlWorker = new NewXmlFetcher()
        xmlWorker.onmessage = (message: MessageEvent) => {
          // message.data will have .id and either .error or .xml
          const { resolve, reject } = this.resolvers[message.data.id]

          xmlWorker.terminate()

          if (message.data.error) reject(message.data.error)
          resolve(message.data.xml)
        }
      }

      // save the promise by id so we can look it up when we get messages
      const id = this.resolverId++

      xmlWorker.postMessage(Object.assign({ id, fileSystem: this.fileSystem }, props))

      const promise = new Promise((resolve, reject) => {
        this.resolvers[id] = { resolve, reject }
      })
      return promise
    },

    async loadNetworks() {
      try {
        if (!this.fileSystem || !this.vizDetails.network || !this.vizDetails.transitSchedule) return

        this.loadingText = 'Loading networks...'

        // this._xmlWorkers.push(worker) // save it so we can terminate if we have to

        const roads = this.fetchXML({
          worker: this._roadFetcher,
          slug: this.fileSystem.slug,
          filePath: this.myState.subfolder + '/' + this.vizDetails.network,
          options: { attributeNamePrefix: '' },
        })

        const transit = this.fetchXML({
          worker: this._transitFetcher,
          slug: this.fileSystem.slug,
          filePath: this.myState.subfolder + '/' + this.vizDetails.transitSchedule,
          options: {
            attributeNamePrefix: '',
            alwaysArray: [
              'transitSchedule.transitLine.transitRoute',
              'transitSchedule.transitLine.transitRoute.departures.departure',
            ],
          },
        })

        // and wait for them to all complete
        const results = await Promise.all([roads, transit])
        return { roadXML: results[0], transitXML: results[1], ridership: [] }
      } catch (e) {
        console.error('TRANSIT:', e)
        this.loadingText = '' + e
        globalStore.commit('error', 'Transit: ' + e)
        return null
      }
    },

    loadDemandData(filename: string): Promise<any[]> {
      const promise: Promise<any[]> = new Promise<any[]>((resolve, reject) => {
        if (!filename) resolve([])
        this.loadingText = 'Loading demand...'
        const worker = new GzipWorker() as Worker

        worker.onmessage = (event: MessageEvent) => {
          this.loadingText = 'Processing demand...'
          const csvData = new TextDecoder('utf-8').decode(event.data)
          worker.terminate()

          Papaparse.parse(csvData, {
            // preview: 10000,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            worker: true,
            complete: results => {
              resolve(this.processDemand(results))
            },
          })
        }

        worker.postMessage({
          filePath: this.myState.subfolder + '/' + filename,
          fileSystem: this.fileSystem,
        })
      })
      return promise
    },

    processDemand(results: Papaparse.ParseResult<unknown>) {
      // todo: make sure meta contains fields we need!
      this.loadingText = 'Processing demand data...'

      // build crossfilter
      console.log('BUILD crossfilter')
      this.cfDemand = crossfilter(results.data)
      this.cfDemandLink = this.cfDemand.dimension((d: any) => d.linkIdsSincePreviousStop)

      // build link-level passenger ridership
      console.log('COUNTING RIDERSHIP')

      const linkPassengersById = {} as any
      const group = this.cfDemandLink.group()
      group
        .reduceSum((d: any) => d.passengersAtArrival)
        .all()
        .map(link => {
          linkPassengersById[link.key as any] = link.value
        })

      // and pax load-factors
      const capacity = {} as any
      group
        .reduceSum((d: any) => d.totalVehicleCapacity)
        .all()
        .map(link => {
          capacity[link.key as any] = link.value
        })

      // update passenger value in the transit-link geojson.
      for (const transitLink of this._transitLinks.features) {
        transitLink.properties['pax'] = linkPassengersById[transitLink.properties.id]
        transitLink.properties['cap'] = capacity[transitLink.properties.id]
        transitLink.properties['loadfac'] =
          Math.round(
            (1000 * linkPassengersById[transitLink.properties.id]) /
              capacity[transitLink.properties.id]
          ) / 1000
      }

      this.metrics = this.metrics.concat([
        { field: 'pax', name_en: 'Passengers', name_de: 'Passagiere' },
        { field: 'loadfac', name_en: 'Load Factor', name_de: 'Auslastung' },
      ])

      const source = this.mymap.getSource('transit-source') as GeoJSONSource
      source.setData(this._transitLinks)

      this.loadingText = ''
      return []
    },

    async processInputs(networks: NetworkInputs) {
      this.loadingText = 'Preparing...'
      // spawn transit helper web worker
      this._transitHelper = new TransitSupplyWorker()

      this._transitHelper.onmessage = async (buffer: MessageEvent) => {
        this.receivedProcessedTransit(buffer)
      }

      this._transitHelper.postMessage({
        xml: networks,
        projection: this.projection,
      })
    },

    async receivedProcessedTransit(buffer: MessageEvent) {
      if (buffer.data.status) {
        this.loadingText = buffer.data.status
        return
      }
      const { network, routeData, stopFacilities, transitLines, mapExtent } = buffer.data
      this._network = network
      this._routeData = routeData
      this._stopFacilities = stopFacilities
      this._transitLines = transitLines
      this._mapExtentXYXY = mapExtent

      this._transitHelper.terminate()

      this.loadingText = 'Summarizing departures...'

      await this.processDepartures()

      // Build the links layer and add it
      this._transitLinks = await this.constructDepartureFrequencyGeoJson()
      this.addTransitToMap(this._transitLinks)

      this.handleClickedMetric({ field: 'departures' })

      localStorage.setItem(this.$route.fullPath + '-bounds', JSON.stringify(this._mapExtentXYXY))
      this.mymap.fitBounds(this._mapExtentXYXY, { animate: false })

      if (this.vizDetails.demand) await this.loadDemandData(this.vizDetails.demand)

      this.loadingText = ''
    },

    async processDepartures() {
      this.loadingText = 'Processing departures...'

      for (const id in this._transitLines) {
        if (this._transitLines.hasOwnProperty(id)) {
          const transitLine = this._transitLines[id]
          for (const route of transitLine.transitRoutes) {
            for (const linkID of route.route) {
              if (!(linkID in this._departures))
                this._departures[linkID] = { total: 0, routes: new Set() }

              this._departures[linkID].total += route.departures
              this._departures[linkID].routes.add(route.id)

              this._maximum = Math.max(this._maximum, this._departures[linkID].total)
            }
          }
        }
      }
    },

    addTransitToMap(geodata: any) {
      this._geoTransitLinks = geodata

      this.mymap.addSource('transit-source', {
        data: geodata,
        type: 'geojson',
      } as any)

      this.mymap.addLayer({
        id: 'transit-link',
        source: 'transit-source',
        type: 'line',
        paint: {
          'line-opacity': 1.0,
          'line-width': 1,
          'line-color': ['get', 'color'],
        },
      })

      this.mymap.on('click', 'transit-link', (e: maplibregl.MapMouseEvent) => {
        this.clickedOnTransitLink(e)
      })

      // turn "hover cursor" into a pointer, so user knows they can click.
      this.mymap.on('mousemove', 'transit-link', (e: maplibregl.MapLayerMouseEvent) => {
        this.mymap.getCanvas().style.cursor = e ? 'pointer' : 'grab'
        this.hoveredOnElement(e)
      })

      // and back to normal when they mouse away
      this.mymap.on('mouseleave', 'transit-link', () => {
        this.mymap.getCanvas().style.cursor = 'grab'
        this.mapPopup.remove()
      })
    },

    hoveredOnElement(event: any) {
      const props = event.features[0].properties

      let content = '<div class="map-popup">'

      for (const metric of this.metrics) {
        let label = this.$i18n.locale == 'de' ? metric.name_de : metric.name_en
        label = label.replaceAll(' ', '&nbsp;')

        if (!isNaN(props[metric.field]))
          content += `
          <div style="display: flex">
            <div>${label}:&nbsp;&nbsp;</div>
            <b style="margin-left: auto; text-align: right">${props[metric.field]}</b>
          </div>`
      }

      content += '<div>'
      this.mapPopup.setLngLat(event.lngLat).setHTML(content).addTo(this.mymap)
    },

    async constructDepartureFrequencyGeoJson() {
      const geojson = []

      for (const linkID in this._departures) {
        if (this._departures.hasOwnProperty(linkID)) {
          const link = this._network.links[linkID]
          const coordinates = [
            [this._network.nodes[link.from].x, this._network.nodes[link.from].y],
            [this._network.nodes[link.to].x, this._network.nodes[link.to].y],
          ]

          const departures = this._departures[linkID].total

          // shift scale from 0->1 to 0.25->1.0, because dark blue is hard to see on a black map
          const ratio = 0.25 + (0.75 * (departures - 1)) / this._maximum
          const colorBin = Math.floor(COLOR_CATEGORIES * ratio)

          let isRail = true
          for (const route of this._departures[linkID].routes) {
            if (this._routeData[route].transportMode === 'bus') {
              isRail = false
            }
          }

          let line = {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: coordinates,
            },
            properties: {
              color: isRail ? '#a03919' : _colorScale[colorBin],
              colorBin: colorBin,
              departures: departures,
              // pax: 0,
              // loadfac: 0,
              // cap: 0,
              id: linkID,
              isRail: isRail,
              from: link.from, // _stopFacilities[fromNode].name || fromNode,
              to: link.to, // _stopFacilities[toNode].name || toNode,
            },
          }

          line = this.offsetLineByMeters(line, 15)
          geojson.push(line)
        }
      }

      geojson.sort(function (a: any, b: any) {
        if (a.isRail && !b.isRail) return -1
        if (b.isRail && !a.isRail) return 1
        return 0
      })

      return { type: 'FeatureCollection', features: geojson }
    },

    offsetLineByMeters(line: any, metersToTheRight: number) {
      try {
        const offsetLine = turf.lineOffset(line, metersToTheRight, { units: 'meters' })
        return offsetLine
      } catch (e) {
        // offset can fail if points are exactly on top of each other; ignore.
      }
      return line
    },

    removeStopMarkers() {
      this.stopMarkers = []
    },

    async showTransitStops() {
      this.removeStopMarkers()

      const route = this.selectedRoute
      const stopSizeClass = 'stopmarker' // this.mymap.getZoom() > SHOW_STOPS_AT_ZOOM_LEVEL ? 'stop-marker-big' : 'stop-marker'
      const mapBearing = this.mymap.getBearing()

      let bearing

      for (const [i, stop] of route.routeProfile.entries()) {
        const coord = [this._stopFacilities[stop.refId].x, this._stopFacilities[stop.refId].y]
        // recalc bearing for every node except the last
        if (i < route.routeProfile.length - 1) {
          const point1 = turf.point([coord[0], coord[1]])
          const point2 = turf.point([
            this._stopFacilities[route.routeProfile[i + 1].refId].x,
            this._stopFacilities[route.routeProfile[i + 1].refId].y,
          ])
          bearing = turf.bearing(point1, point2) - mapBearing // so icons rotate along with map
        }

        const xy = this.mymap.project([coord[0], coord[1]])

        // every marker has a latlng coord and a bearing
        const marker = { i, bearing, xy: { x: Math.floor(xy.x), y: Math.floor(xy.y) } }
        this.stopMarkers.push(marker)
      }
    },

    showTransitRoute(routeID: string) {
      if (!routeID) return

      const route = this._routeData[routeID]
      // console.log({ selectedRoute: route })

      this.selectedRoute = route

      const source = this.mymap.getSource('selected-route-data') as GeoJSONSource
      if (source) {
        source.setData(route.geojson)
      } else {
        this.mymap.addSource('selected-route-data', {
          data: route.geojson,
          type: 'geojson',
        })
      }

      if (!this.mymap.getLayer('selected-route')) {
        this.mymap.addLayer({
          id: 'selected-route',
          source: 'selected-route-data',
          type: 'line',
          paint: {
            'line-opacity': 1.0,
            'line-width': 5, // ['get', 'width'],
            'line-color': '#097c43', // ['get', 'color'],
          },
        })
      }
    },

    removeSelectedRoute() {
      if (this.selectedRoute) {
        try {
          this.mymap.removeLayer('selected-route')
        } catch (e) {
          // oh well
        }
        this.selectedRoute = null
      }
    },

    clickedOnTransitLink(e: any) {
      this.removeStopMarkers()
      this.removeSelectedRoute()

      // the browser delivers some details that we need, in the fn argument 'e'
      const props = e.features[0].properties
      const routeIDs = this._departures[props.id].routes

      this.calculatePassengerVolumes(props.id)

      const routes = []
      for (const id of routeIDs) {
        routes.push(this._routeData[id])
      }

      // sort by highest departures first
      routes.sort(function (a, b) {
        return a.departures > b.departures ? -1 : 1
      })

      this.routesOnLink = routes
      this.highlightAllAttachedRoutes()

      // highlight the first route, if there is one
      if (routes.length > 0) this.showRouteDetails(routes[0].id)
    },

    calculatePassengerVolumes(id: string) {
      if (!this.cfDemandLink || !this.cfDemand) return

      this.cfDemandLink.filter(id)

      const allLinks = this.cfDemand.allFiltered()
      let sum = 0

      allLinks.map(d => {
        sum = sum + d.passengersBoarding + d.passengersAtArrival - d.passengersAlighting
      })

      // console.log({ sum, allLinks })
    },

    removeAttachedRoutes() {
      for (const layerID of this._attachedRouteLayers) {
        try {
          this.mymap.removeLayer('route-' + layerID)
          this.mymap.removeSource('source-route-' + layerID)
        } catch (e) {
          //meh
        }
      }
      this._attachedRouteLayers = []
    },

    highlightAllAttachedRoutes() {
      this.removeAttachedRoutes()

      for (const route of this.routesOnLink) {
        this.mymap.addSource('source-route-' + route.id, {
          data: route.geojson,
          type: 'geojson',
        })
        this.mymap.addLayer({
          id: 'route-' + route.id,
          source: 'source-route-' + route.id,
          type: 'line',
          paint: {
            'line-opacity': 0.7,
            'line-width': 8, // ['get', 'width'],
            'line-color': '#ccff33', // ['get', 'color'],
          },
        })
        this._attachedRouteLayers.push(route.id)
      }
    },

    pressedEscape() {
      this.removeSelectedRoute()
      this.removeStopMarkers()
      this.removeAttachedRoutes()

      this.selectedRoute = null
      this.routesOnLink = []
    },

    pressedArrowKey(delta: number) {
      if (!this.selectedRoute) return

      let i = this.routesOnLink.indexOf(this.selectedRoute)
      i = i + delta

      if (i < 0 || i >= this.routesOnLink.length) return

      this.showRouteDetails(this.routesOnLink[i].id)
    },

    clearData() {
      this._attachedRouteLayers = []
      this._departures = {}
      this._mapExtentXYXY = [180, 90, -180, -90]
      this._maximum = 0
      this._network = { nodes: {}, links: {} }
      this._routeData = {}
      this._stopFacilities = {}
      this._transitLinks = null
      this._transitLines = {}
      this.selectedRoute = null
      this.cfDemand = null
      this.cfDemandLink?.dispose()
      this.resolvers = {}
      this.routesOnLink = []
      this.selectedRoute = {}
      this.stopMarkers = []
      this._linkData = null
      this._geoTransitLinks = null
    },
  },

  async mounted() {
    this.$store.commit('setFullScreen', !this.thumbnail)

    this.clearData()

    // populate props after we attach, not before!
    this.myState.subfolder = this.subfolder
    this.myState.yamlConfig = this.yamlConfig ?? ''
    this.myState.thumbnail = this.thumbnail

    await this.getVizDetails()

    if (this.thumbnail) return

    await this.prepareView()
    this.setupMap()
  },

  beforeDestroy() {
    if (this.mymap) this.mymap.remove()

    this.clearData()

    if (this.xmlWorker) this.xmlWorker.terminate()
    if (this._roadFetcher) this._roadFetcher.destroy()
    if (this._transitFetcher) this._transitFetcher.destroy()
    if (this._transitHelper) this._transitHelper.terminate()

    this.$store.commit('setFullScreen', false)
  },
})

// !register plugin!
globalStore.commit('registerPlugin', {
  kebabName: 'transit',
  prettyName: 'Transit Demand',
  description: 'Transit passengers and ridership',
  // filePatterns: ['viz-pt-demand*.y?(a)ml', '*output_transitSchedule.xml?(.gz)'],
  filePatterns: ['*transitSchedule.xml?(.gz)'],
  component: MyComponent,
} as VisualizationPlugin)

export default MyComponent

const _colorScale = colormap({ colormap: 'viridis', nshades: COLOR_CATEGORIES })
</script>

<style scoped lang="scss">
@import '@/styles.scss';

.mapboxgl-popup-content {
  padding: 0px 20px 0px 0px;
  opacity: 0.95;
  box-shadow: 0 0 3px #00000080;
}

h4,
p {
  margin: 0px 10px;
}

.transit-popup {
  padding: 0px 0px;
  margin: 0px 0px;
  border-style: solid;
  border-width: 0px 0px 0px 20px;
}

.transit-viz {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: $thumbnailHeight;
  background: url('assets/thumbnail.jpg') no-repeat;
  background-size: cover;
  pointer-events: none;
}

.map-container {
  position: relative;
  flex: 1;
  pointer-events: auto;
  background: url('assets/thumbnail.jpg') no-repeat;
  background-color: #eee;
  background-size: cover;
  min-height: $thumbnailHeight;
}

.hide-thumbnail {
  background: none;
  z-index: 0;
}

.control-panel {
  position: absolute;
  bottom: 0;
  display: flex;
  flex-direction: row;
  font-size: 0.8rem;
  margin: 0 0 0.5rem 0.5rem;
  pointer-events: auto;
  background-color: var(--bgPanel);
  padding: 0.5rem 0.5rem;
  filter: drop-shadow(0px 2px 4px #22222233);
}

.is-dashboard {
  position: static;
  margin: 0 0;
  padding: 0.25rem 0 0 0;
  filter: unset;
  background-color: unset;
}

.legend {
  background-color: var(--bgPanel);
  padding: 0.25rem 0.5rem;
  position: absolute;
  bottom: 3.5rem;
  right: 0.5rem;
}

.control-label {
  margin: 0 0;
  font-size: 0.8rem;
  font-weight: bold;
}

.route {
  padding: 5px 0px;
  text-align: left;
  color: var(--text);
  border-left: solid 8px #00000000;
  border-right: solid 8px #00000000;
}

.route:hover {
  background-color: var(--bgCream3);
  cursor: pointer;
}

h3 {
  margin: 0px 0px;
  font-size: 1.5rem;
  line-height: 1.7rem;
}

.route-title {
  font-size: 1rem;
  font-weight: bold;
  line-height: 1.2rem;
  margin-left: 10px;
  color: var(--link);
}

.stopmarker {
  width: 12px;
  height: 12px;
  cursor: pointer;
}

.stop-marker-big {
  background: url('assets/icon-stop-triangle.png') no-repeat;
  background-size: 100%;
  width: 16px;
  height: 16px;
}

.highlightedRoute {
  background-color: #faffae;
  border-left: solid 8px #606aff;
  color: black;
}

.highlightedRoute:hover {
  background-color: #faffae;
}

.bigtitle {
  font-weight: bold;
  font-style: italic;
  font-size: 20px;
  margin: 20px 0px;
}

.info-header {
  text-align: center;
  background-color: #097c43;
  padding: 0.5rem 0rem;
  border-top: solid 1px #888;
  border-bottom: solid 1px #888;
}

.project-summary-block {
  width: 16rem;
  grid-column: 1 / 2;
  grid-row: 1 / 2;
  margin: 0px auto auto 0px;
  z-index: 10;
}

@keyframes slideInFromLeft {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

.stop-marker {
  position: absolute;
  width: 12px;
  height: 12px;
  background: url('assets/icon-stop-triangle.png') no-repeat;
  transform: translate(-50%, -50%);
  background-size: 100%;
  cursor: pointer;
}

.help-text {
  color: #ccc;
}

.left-side {
  position: absolute;
  top: 0;
  left: 0;
  margin-bottom: auto;
  margin-right: auto;
  display: flex;
  flex-direction: row;
  pointer-events: auto;
  max-height: 40%;
  max-width: 80%;
  opacity: 0.96;
}

.right-side {
  z-index: 1;
  position: absolute;
  bottom: 3.75rem;
  right: 0;
  color: white;
  display: flex;
  flex-direction: row;
  pointer-events: auto;
}

.panel-items {
  color: var(--text);
  display: flex;
  flex-direction: column;
  margin: 0 0;
  max-height: 100%;
}

.panel-item {
  display: flex;
  flex-direction: column;

  h3 {
    padding: 0.5rem 1rem 1.5rem 0.5rem;
  }
}

.route-list {
  user-select: none;
  position: relative;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  cursor: pointer;
  scrollbar-color: #888 var(--bgCream);
  -webkit-scrollbar-color: #888 var(--bgCream);

  h3 {
    font-size: 1.2rem;
  }
}

.dashboard-panel {
  display: flex;
  flex-direction: column;
}

.metric-buttons {
  display: flex;
  flex-direction: row;
}

.metric-button {
  margin-right: 0.5rem;
}

.detailed-route-data {
  display: flex;
  flex-direction: row;
}

.col {
  display: flex;
  flex-direction: column;
}

.map-styles {
  height: 100%;
}

.status-corner {
  position: absolute;
  bottom: 0;
  left: 0;
  z-index: 15;
  display: flex;
  flex-direction: row;
  background-color: var(--bgPanel);
  padding: 0rem 3rem;

  a {
    color: white;
    text-decoration: none;

    &.router-link-exact-active {
      color: white;
    }
  }

  p {
    color: var(--textFancy);
    font-weight: normal;
    font-size: 1.3rem;
    line-height: 2.6rem;
    margin: auto 0.5rem auto 0;
    padding: 0 0;
  }
}
</style>
