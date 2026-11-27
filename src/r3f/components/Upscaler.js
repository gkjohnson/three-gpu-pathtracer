/** @import { ReactNode } from 'react' */
/** @import { FSRUpscaler } from '../../webgpu/index.js' */
import { createContext, createElement, useContext, useLayoutEffect } from 'react';
import { WebGPUPathTracerContext } from './WebGPUPathTracer.js';
import { useShallowOptions } from '../utilities/useOptions.js';

// context for accessing the attached upscaler
export const UpscalerContext = createContext( null );

/**
 * Attaches an upscaler to the nearest parent WebGPUPathTracer. Must be a child of WebGPUPathTracer.
 * All properties on the upscaler instance can be set as props directly. The caller owns the instance
 * and disposes it.
 * @component
 * @param {Object} props
 * @param {FSRUpscaler} props.upscaler - The upscaler instance to attach.
 * @param {ReactNode} [props.children]
 */
export function Upscaler( props ) {

	const { upscaler, children, ...options } = props;
	const pathTracer = useContext( WebGPUPathTracerContext );

	// assigns any provided options to the upscaler
	useShallowOptions( upscaler, options );

	// attach the upscaler
	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		pathTracer.setUpscaler( upscaler );
		return () => {

			pathTracer.setUpscaler( null );

		};

	}, [ pathTracer, upscaler ] );

	return createElement( UpscalerContext.Provider, { value: upscaler }, children );

}
