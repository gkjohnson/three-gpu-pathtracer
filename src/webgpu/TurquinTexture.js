import { Storage3DTexture, RedFormat, LinearFilter, HalfFloatType, MathUtils } from 'three/webgpu';
import { storageTexture3D, globalId, uniform, texture3D, sampler } from 'three/tsl';
import { turquinIntegralFn } from './nodes/material.wgsl.js';
import { ComputeKernel } from './compute/ComputeKernel.js';
import { wgslTagFn, proxyFn } from 'three-mesh-bvh/webgpu';

const RESOLUTION = 32;
const WORKGROUP_SIZE = 16;

// A 3D texture of the GGX single-scatter directional albedo E, used for Turquin multiscatter
// energy compensation (https://blog.selfshadow.com/publications/turquin/ms_comp_final.pdf).
export class TurquinTexture extends Storage3DTexture {

	constructor() {

		// layer 0: conductor
		// layer 1 - 10: dielectric reflection over the ior range
		// layer 11 - 20: transmissive total energy entering
		// layer 21 - 30: transmissive total energy exiting
		super( RESOLUTION, RESOLUTION, 31 );

		this.type = HalfFloatType;
		this.format = RedFormat;
		this.minFilter = LinearFilter;
		this.magFilter = LinearFilter;

		// TODO: turquin paper suggests 32 layers for dielectric
		this.dielectricLayerCount = 10;
		this.transmissiveLayerCount = 10;
		this.minIoR = 1;
		this.maxIoR = 2.5;

		// construct the fns
		this.sampleConductorFn = proxyFn( '_sampleConductorFn', this );
		this.sampleDielectricFn = proxyFn( '_sampleDielectricFn', this );
		this.sampleTransmissiveFn = proxyFn( '_sampleTransmissiveFn', this );

	}

	// bakes the albedo table into the texture. Must be called once the renderer is initialized.
	generate( renderer ) {

		const {
			dielectricLayerCount,
			transmissiveLayerCount,
			minIoR,
			maxIoR,
		} = this;

		const params = {
			outputTarget: storageTexture3D( this ).toWriteOnly(),
			globalId,
			eta: uniform( 1 ),
			layer: uniform( 0, 'uint' ),
			includeFresnel: uniform( 0 ),
			includeRefraction: uniform( 0 ),
		};

		const dispatch = [ RESOLUTION / WORKGROUP_SIZE, RESOLUTION / WORKGROUP_SIZE, 1 ];
		const kernel = new ComputeKernel( turquinIntegralFn( params ), { workgroupSize: [ WORKGROUP_SIZE, WORKGROUP_SIZE, 1 ] } );

		// metallic
		params.layer.value = 0;
		params.eta.value = 1;
		params.includeFresnel.value = 0;
		params.includeRefraction.value = 0;
		renderer.compute( kernel.kernel, dispatch );

		// dielectric
		for ( let i = 0; i < dielectricLayerCount; i ++ ) {

			params.layer.value ++;
			params.eta.value = 1 / MathUtils.mapLinear( i, 0, dielectricLayerCount - 1, minIoR, maxIoR );
			params.includeFresnel.value = 1;
			renderer.compute( kernel.kernel, dispatch );

		}

		// transmissive total energy - entering and exiting layers over the same ior range
		params.includeFresnel.value = 1;
		params.includeRefraction.value = 1;
		for ( let i = 0; i < transmissiveLayerCount; i ++ ) {

			const ior = MathUtils.mapLinear( i, 0, transmissiveLayerCount - 1, minIoR, maxIoR );

			// entering - air incident
			params.layer.value = 1 + dielectricLayerCount + i;
			params.eta.value = 1 / ior;
			renderer.compute( kernel.kernel, dispatch );

			// exiting - volume incident, TIR side
			params.layer.value = 1 + dielectricLayerCount + transmissiveLayerCount + i;
			params.eta.value = ior;
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
		const layerDepth = 1.0 / ( 1 + dielectricLayerCount + 2 * transmissiveLayerCount );
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

				let blockStart = 1.0;
				let layer = ${ mapLinearClampedFn }(
					ior,
					f32( ${ minIoR } ), f32( ${ maxIoR } ),
					0.5, f32( ${ dielectricLayerCount } ) - 0.5,
				) + blockStart;

				let uvw = vec3f( cosTheta0, roughness, layer * ${ layerDepth } );
				return textureSampleLevel( ${ textureNode }, ${ samplerNode }, uvw, 0 ).r;

			}
		`;

		// transmissive fetch fn - entering selects the air-incident block, otherwise the
		// volume-incident (TIR) block. ior is clamped at the valid range
		const enterBlockStart = 1 + dielectricLayerCount;
		const exitBlockStart = 1 + dielectricLayerCount + transmissiveLayerCount;
		this._sampleTransmissiveFn = wgslTagFn/* wgsl */`
			fn sampleTransmissive( cosTheta0: f32, roughness: f32, ior: f32, entering: bool ) -> f32 {

				let blockStart = select(
					f32( ${ exitBlockStart } ),
					f32( ${ enterBlockStart } ),
					entering
				);
				let layer = ${ mapLinearClampedFn }(
					ior,
					f32( ${ minIoR } ), f32( ${ maxIoR } ),
					0.5, f32( ${ transmissiveLayerCount } ) - 0.5,
				) + blockStart;

				let uvw = vec3f( cosTheta0, roughness, layer * ${ layerDepth } );
				return textureSampleLevel( ${ textureNode }, ${ samplerNode }, uvw, 0 ).r;

			}
		`;

	}

}
