/** @import { ReactNode } from 'react' */
import { createContext, createElement, forwardRef, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGPUPathTracer as WebGPUPathTracerImpl } from '../../webgpu/WebGPUPathTracer.js';
import { useDeepOptions } from '../utilities/useOptions.js';
import { useApplyRefs } from '../utilities/useApplyRefs.js';

// context for accessing the path tracer
export const WebGPUPathTracerContext = createContext( null );

/**
 * Returns the nearest parent WebGPUPathTracer instance, or null if there is none. Use it to
 * notify the path tracer of scene changes with `setScene`, `updateMaterials`, `updateTransforms`,
 * `updateLights`, `updateEnvironment`, or `reset`.
 * @returns {WebGPUPathTracerImpl|null}
 */
export function usePathTracer() {

	return useContext( WebGPUPathTracerContext );

}

/**
 * Wrapper for the WebGPUPathTracer class that renders the fiber scene and camera. All properties
 * on the path tracer instance can be set as props using dot-notation for nested properties
 * (e.g. `renderer-toneMapping`). Scene changes are not tracked: call the update functions on the
 * instance from `usePathTracer` after adding, moving, or restyling objects.
 * @component
 * @param {Object} props
 * @param {boolean} [props.enabled=true] - If false, the scene is rasterized normally instead.
 * @param {number} [props.renderPriority=1] - Priority of the frame callback used to render.
 * @param {ReactNode} [props.children] - Children rendered with access to the path tracer context.
 */
export const WebGPUPathTracer = forwardRef( function WebGPUPathTracer( props, ref ) {

	const { enabled = true, renderPriority = 1, children, ...options } = props;
	const [ gl, scene, camera, controls, size ] = useThree( state => [ state.gl, state.scene, state.camera, state.controls, state.size ] );
	const [ pathTracer, setPathTracer ] = useState( null );

	// create the path tracer
	useEffect( () => {

		const pathTracer = new WebGPUPathTracerImpl( gl );
		setPathTracer( pathTracer );

		return () => {

			pathTracer.dispose();
			setPathTracer( null );

		};

	}, [ gl ] );

	// set the scene and camera
	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		pathTracer.setScene( scene, camera );

	}, [ pathTracer, scene, camera ] );

	// fiber updates the camera projection on resize
	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		pathTracer.updateCamera();

	}, [ pathTracer, size ] );

	// update the camera when the default controls change
	useEffect( () => {

		if ( pathTracer === null || ! controls ) {

			return;

		}

		const onChange = () => pathTracer.updateCamera();
		controls.addEventListener( 'change', onChange );
		return () => {

			controls.removeEventListener( 'change', onChange );

		};

	}, [ pathTracer, controls ] );

	// render a sample, or fall back to rasterizing the scene. A positive priority takes over
	// rendering from fiber so both cases have to draw.
	useFrame( state => {

		if ( pathTracer !== null && enabled ) {

			pathTracer.renderSample();

		} else {

			state.gl.render( state.scene, state.camera );

		}

	}, renderPriority );

	// assign ref
	useApplyRefs( pathTracer, ref );

	// assign options recursively
	useDeepOptions( pathTracer, options );

	return createElement( WebGPUPathTracerContext.Provider, { value: pathTracer }, children );

} );
