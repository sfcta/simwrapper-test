import React, { useState } from 'react'
import DeckGL from '@deck.gl/react'
import { StaticMap } from 'react-map-gl'
import { FlowMapLayer } from '@flowmap.gl/layers'

import { MAPBOX_TOKEN, REACT_VIEW_HANDLES } from '@/Globals'
import globalStore from '@/store'

export default function Layer({
  props = {} as any,
  viewId = 0, // viewId: this must be unique;
}) {
  const { locations, flows, dark, elapsed, vizDetails } = props

  const [viewState, setViewState] = useState(globalStore.state.viewState)
  const [hoverInfo, setHoverInfo] = useState({})

  // register setViewState in global view updater so we can respond to map motion
  REACT_VIEW_HANDLES[viewId] = () => {
    setViewState(globalStore.state.viewState)
  }

  function handleClick() {
    console.log('click!')
  }

  function handleHover(hover: any) {
    // console.log(hover)
    // setHoverInfo(hover)
  }

  function handleViewState(view: any) {
    setViewState(view)
    view.center = [view.longitude, view.latitude]
    globalStore.commit('setMapCamera', view)
  }

  // const data = {
  //   locations: [
  //     { id: 'SF', lat: 37, lon: -122 },
  //     { id: 'NYC', lat: 42, lon: -108 },
  //     { id: 'Chicago', lat: 45, lon: -115 },
  //   ],
  //   flows: [
  //     { o: 'SF', d: 'NYC', v: 100 },
  //     { o: 'SF', d: 'Chicago', v: 50 },
  //     { o: 'NYC', d: 'SF', v: 210 },
  //     { o: 'NYC', d: 'Chicago', v: 30 },
  //     { o: 'Chicago', d: 'NYC', v: 75 },
  //     { o: 'Chicago', d: 'SF', v: 85 },
  //   ],
  // }
  const layer = new FlowMapLayer({
    data: props,
    id: 'my-flowmap-layer' + viewId,
    colorScheme: vizDetails.colorScheme,
    highlightColor: vizDetails.highlightColor,
    adaptiveScalesEnabled: true,
    animationEnabled: vizDetails.animationEnabled,
    clusteringEnabled: vizDetails.clusteringEnabled,
    clusteringAuto: vizDetails.clusteringAuto,
    clusteringLevel: vizDetails.clusteringLevel,
    //labelsEnabled: vizDetails.labelsEnabled,
    locationLabelsEnabled: vizDetails.locationLabelsEnabled,
    locationTotalsEnabled: vizDetails.locationTotalsEnabled,
    darkMode: vizDetails.darkMode,
    pickable: vizDetails.pickable,
    // maxFlowThickness: 15,
    // maxLocationCircleSize: 20,
    opacity: vizDetails.opacity,
    //outlineThickness: vizDetails.outlineThickness,
    //showOnlyTopFlows: vizDetails.showOnlyTopFlows,
    maxTopFlowsDisplayNum: vizDetails.maxTopFlowsDisplayNum,
    onHover: handleHover,
    getLocationId: (location: any) => location.id,
    getLocationLat: (location: any) => location.lat,
    getLocationLon: (location: any) => location.lon,
    getLocationName: (location: any) => location.id,
    getFlowOriginId: (flow: any) => flow.o,
    getFlowDestId: (flow: any) => flow.d,
    getFlowMagnitude: (flow: any) => flow.v || null,
    fadeEnabled: true,
    fadeAmount: 3,
    fadeOpacityEnabled: true,
  })

  return (
    /*
    //@ts-ignore */
    <DeckGL
      layers={[layer]}
      controller={true}
      viewState={viewState}
      pickingRadius={4}
      getCursor={() => 'pointer'}
      onClick={handleClick}
      onViewStateChange={(e: any) => handleViewState(e.viewState)}
    >
      {
        /*
      // @ts-ignore */
        <StaticMap mapStyle={globalStore.getters.mapStyle} mapboxApiAccessToken={MAPBOX_TOKEN} />
      }
    </DeckGL>
  )
}
