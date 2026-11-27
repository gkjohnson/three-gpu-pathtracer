/** @import { ReactNode } from 'react' */
/** @import { OIDNDenoiser } from '../../webgpu/index.js' */
import { createContext, createElement, useContext, useLayoutEffect } from 'react';
import { WebGPUPathTracerContext } from './WebGPUPathTracer.js';
import { useShallowOptions } from '../utilities/useOptions.js';

// context for accessing the attached denoiser
export const DenoiserContext = createContext( null );

/**
 * Attaches a denoiser to the nearest parent WebGPUPathTracer. Must be a child of WebGPUPathTracer.
 * All properties on the denoiser instance can be set as props directly. The caller owns the instance
 * and disposes it.
 * @component
 * @param {Object} props
 * @param {OIDNDenoiser} props.denoiser - The denoiser instance to attach.
 * @param {ReactNode} [props.children]
 */
export function Denoiser( props ) {

	const { denoiser, children, ...options } = props;
	const pathTracer = useContext( WebGPUPathTracerContext );

	// assigns any provided options to the denoiser
	useShallowOptions( denoiser, options );

	// attach the denoiser
	useLayoutEffect( () => {

		if ( pathTracer === null ) {

			return;

		}

		pathTracer.setDenoiser( denoiser );
		return () => {

			pathTracer.setDenoiser( null );

		};

	}, [ pathTracer, denoiser ] );

	return createElement( DenoiserContext.Provider, { value: denoiser }, children );

}
