import { Storage3DTexture, RedFormat, LinearFilter, HalfFloatType, MathUtils } from 'three/webgpu';
import { storageTexture3D, globalId, uniform, texture3D, sampler } from 'three/tsl';
import { albedoIntegralMetallic } from './nodes/material.wgsl.js';
import { ComputeKernel } from './compute/ComputeKernel.js';
import { wgslTagFn, proxyFn } from 'three-mesh-bvh/webgpu';

const RESOLUTION = 32;
const WORKGROUP_SIZE = 16;

// A 3D texture of the GGX single-scatter directional albedo E, used for Turquin multiscatter
// energy compensation (https://blog.selfshadow.com/publications/turquin/ms_comp_final.pdf).
export class TurquinTexture extends Storage3DTexture {

	constructor() {

		super( RESOLUTION, RESOLUTION, 11 );

		this.type = HalfFloatType;
		this.format = RedFormat;
		this.minFilter = LinearFilter;
		this.magFilter = LinearFilter;

		this.dielectricLayerCount = 10;
		this.minIoR = 1;
		this.maxIoR = 2.5;

		// construct the fns
		this.sampleConductorFn = proxyFn( '_sampleConductorFn', this );
		this.sampleDielectricFn = proxyFn( '_sampleDielectricFn', this );

	}

	// bakes the albedo table into the texture. Must be called once the renderer is initialized.
	generate( renderer ) {

		const {
			dielectricLayerCount,
			minIoR,
			maxIoR,
		} = this;

		const params = {
			outputTarget: storageTexture3D( this ).toWriteOnly(),
			globalId,
			ior: uniform( 1.5 ),
			layer: uniform( 0, 'uint' ),
			includeFresnel: uniform( 0 ),
		};

		const dispatch = [ RESOLUTION / WORKGROUP_SIZE, RESOLUTION / WORKGROUP_SIZE, TurquinTexture.DEPTH ];
		const kernel = new ComputeKernel( albedoIntegralMetallic( params ), { workgroupSize: [ WORKGROUP_SIZE, WORKGROUP_SIZE, 1 ] } );

		// metallic
		params.layer.value = 0;
		params.ior.value = 1.5;
		params.includeFresnel.value = 0;
		renderer.compute( kernel.kernel, dispatch );

		// dielectric
		for ( let i = 0; i < dielectricLayerCount; i ++ ) {

			// TODO: ensure fresnel and ior are accounted for in layer generation
			params.layer.value ++;
			params.ior.value = MathUtils.mapLinear( i, 0, dielectricLayerCount, minIoR, maxIoR );
			params.includeFresnel.value = 1;
			renderer.compute( kernel.kernel, dispatch );

		}

		// fns
		// function that maps the given value from range [a0, a1] to [b0, b1]
		const mapLinearClampedFn = wgslTagFn/* wgsl */`
			fn mapLinearClamped( v: f32, a0: f32, a1: f32, b0: f32, b1: f32 ) -> f32 {

				let mapped = saturate( ( v - a0 ) / ( a1 - a0 ) );
				return mix( b0, b1, mapped );

			}
		`;

		// texture nodes
		const textureNode = texture3D( this ).setName( 'turquinTexture' );
		const samplerNode = sampler( this ).setName( 'turquinSampler' );

		// conductor fetch fn
		const layerDepth = 1.0 / ( 1 + dielectricLayerCount );
		this._sampleConductorFn = wgslTagFn/* wgsl */`
			fn sampleConductor( cosTheta0: f32, roughness: f32 ) -> f32 {

				let layer = 0.5;
				let uvw = vec3f( cosTheta0, roughness, layer * ${ layerDepth } );
				return textureSampleLevel( ${ textureNode }, ${ samplerNode }, uvw, 0 ).r;

			}
		`;

		// dielectric fetch fn - ior is clamped at the valid range
		this._sampleDielectricFn = wgslTagFn/* wgsl */`
			fn sampleDielectric( cosTheta0: f32, roughness: f32, ior: f32 ) -> f32 {

				let layer = ${ mapLinearClampedFn }(
					ior,
					minIoR, maxIoR,
					1.5, f32( ${ dielectricLayerCount } ) + 1.5,
				);

				let uvw = vec3f( cosTheta0, roughness, layer * ${ layerDepth } );
				return textureSampleLevel( ${ textureNode }, ${ samplerNode }, uvw, 0 ).r;

			}
		`;

	}

}
