import { Matrix3 } from 'three/webgpu';
import { texture, sampler, uniform } from 'three/tsl';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { environmentSampleStruct } from './nodes/structs.wgsl.js';
import { equirectDirectionPdfFn, equirectUvToDirectionFn, luminanceFn } from './nodes/sampling.wgsl.js';

// WebGPU node wrapper around EquirectHdrInfoUniform. Exposes the environment map, its
// importance-sampling CDF, and the scalar parameters as TSL nodes so a compute kernel can
// pull them through proxies ( kernel.envInfo.value.mapNode, ...envInfo.value.totalSumNode, etc )
// instead of copying each field onto the kernel by hand.
//
// Node identity is kept stable across updateFrom / parameter changes - only the node values
// are mutated - so swapping the environment does not force a shader rebuild.
export class EquirectHdrInfoNode extends EquirectHdrInfoUniform {

	constructor() {

		super();

		// environment map + importance-sampling CDF textures, each with a sampler
		this.mapNode = texture( this.map );
		this.mapSampler = sampler( this.map );
		this.marginalNode = texture( this.marginalWeights );
		this.marginalSampler = sampler( this.marginalWeights );
		this.conditionalNode = texture( this.conditionalWeights );
		this.conditionalSampler = sampler( this.conditionalWeights );

		// scalar parameters that assemble into the EnvironmentInfo struct in the shader
		this.rotationNode = uniform( new Matrix3() );
		this.intensityNode = uniform( 1 );
		this.totalSumNode = uniform( this.totalSum );

		this._initFns();

	}

	updateFrom( envMap ) {

		super.updateFrom( envMap );

		const {
			mapNode,
			mapSampler,
			marginalNode,
			marginalSampler,
			conditionalNode,
			conditionalSampler,
			totalSumNode,
		} = this;

		// refresh values in place on the existing nodes so no rebuild is required
		mapNode.value = this.map;
		mapSampler.value = this.map;
		marginalNode.value = this.marginalWeights;
		marginalSampler.value = this.marginalWeights;
		conditionalNode.value = this.conditionalWeights;
		conditionalSampler.value = this.conditionalWeights;
		totalSumNode.value = this.totalSum;

	}

	_initFns() {

		const {
			mapNode,
			mapSampler,
			marginalNode,
			marginalSampler,
			conditionalNode,
			conditionalSampler,
			totalSumNode,
			rotationNode,
			intensityNode,
		} = this;

		this.sampleColor = wgslTagFn/* wgsl */`
			fn sampleEnv( direction: vec3f, uv: vec2f ) -> vec4f {

				let offsetDir = sampleHemisphere( direction, uv ) * 0.5;
				let sampleDir = normalize( ${ rotationNode } * direction + offsetDir );
				let col = sampleEquirectColor( ${ mapNode }, ${ mapSampler }, sampleDir );

				return vec4f( ${ intensityNode } * col.rgb, col.a );

			}
		`;

		this.sampleDir = wgslTagFn/* wgsl */`
			fn sampleEnvDir( r: vec2f ) -> ${ environmentSampleStruct } {

				var result: ${ environmentSampleStruct };

				// walk the CDF: marginal picks the row (v), conditional picks the column (u)
				let v = textureSampleLevel( ${ marginalNode }, ${ marginalSampler }, vec2f( r.x, 0.0 ), 0 ).x;
				let u = textureSampleLevel( ${ conditionalNode }, ${ conditionalSampler }, vec2f( r.y, v ), 0 ).x;
				let uv = vec2f( u, v );
				let totalSum = ${ totalSumNode };

				let direction = ${ equirectUvToDirectionFn }( uv );
				let color = textureSampleLevel( ${ mapNode }, ${ mapSampler }, uv, 0 ).rgb;

				result.direction = transpose( ${ rotationNode } ) * direction;
				result.color = color * ${ intensityNode };

				if ( totalSum != 0.0 ) {

					let lum = ${ luminanceFn }( color );
					let resolution = textureDimensions( ${ mapNode } );
					let pdf = lum / totalSum;
					result.pdf = f32( resolution.x * resolution.y ) * pdf * ${ equirectDirectionPdfFn }( direction );

				} else {

					result.pdf = 0.0;

				}

				return result;

			}
		`;

		this.getDirPdf = wgslTagFn/* wgsl */`
			fn getEnvDirPdf( direction: vec3f ) -> f32 {

				if ( ${ totalSumNode } == 0.0 ) {

					return 0.0;

				}

				let rotatedDir = ${ rotationNode } * direction;
				let color = sampleEquirectColor( ${ mapNode }, ${ mapSampler }, rotatedDir ).rgb;
				let lum = luminance( color );
				let resolution = textureDimensions( ${ mapNode } );
				let pdf = lum / ${ totalSumNode };

				return f32( resolution.x * resolution.y ) * pdf * equirectDirectionPdf( rotatedDir );

			}
		`;

	}

}
