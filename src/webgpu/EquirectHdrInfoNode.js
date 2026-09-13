import { Matrix3 } from 'three/webgpu';
import { texture, sampler, uniform, wgslFn } from 'three/tsl';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { constants, environmentSampleStruct } from './nodes/structs.wgsl.js';
import { equirectDirectionToUvFn, equirectUvToDirectionFn, luminanceFn } from './nodes/sampling.wgsl.js';

// totalWeight includes sin( theta ), which cancels in the solid-angle conversion.
const equirectLuminancePdfFn = wgslFn( /* wgsl */ `

	fn equirectLuminancePdf( luminance: f32, totalWeight: f32, resolution: vec2u ) -> f32 {

		return f32( resolution.x * resolution.y ) * luminance / ( 2.0 * PI * PI * totalWeight );

	}

`, [ constants ] );

export class EquirectHdrInfoNode extends EquirectHdrInfoUniform {

	constructor() {

		super();

		// environment map + importance-sampling CDF textures, each with a sampler
		this.mapNode = texture( this.map );
		this.mapSampler = sampler( this.mapNode );
		this.marginalNode = texture( this.marginalWeights );
		this.marginalSampler = sampler( this.marginalNode );
		this.conditionalNode = texture( this.conditionalWeights );
		this.conditionalSampler = sampler( this.conditionalNode );

		// scalar parameters that assemble into the EnvironmentInfo struct in the shader
		this.rotationNode = uniform( new Matrix3() );
		this.intensityNode = uniform( 1 );
		this.totalSumNode = uniform( this.totalSum );

		this._initFns();

	}

	getPixelWeight( r, g, b, row, height ) {

		// weight the pixel contribution by its spherical solid angle.
		const theta = Math.PI * ( row + 0.5 ) / height;
		return super.getPixelWeight( r, g, b ) * Math.sin( theta );

	}

	updateFrom( envMap ) {

		super.updateFrom( envMap );

		const {
			mapNode,
			marginalNode,
			conditionalNode,
			totalSumNode,
		} = this;

		// refresh values in place on the existing nodes so no rebuild is required
		mapNode.value = this.map;
		marginalNode.value = this.marginalWeights;
		conditionalNode.value = this.conditionalWeights;
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
			fn sampleEnv( direction: vec3f ) -> vec4f {

				let sampleDir = ${ rotationNode } * direction;
				let mapUv = ${ equirectDirectionToUvFn }( sampleDir );
				let col = textureSampleLevel( ${ mapNode }, ${ mapSampler }, mapUv, 0 );

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
					result.pdf = ${ equirectLuminancePdfFn }( lum, totalSum, resolution );

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
				let mapUv = ${ equirectDirectionToUvFn }( rotatedDir );
				let color = textureSampleLevel( ${ mapNode }, ${ mapSampler }, mapUv, 0 ).rgb;
				let lum = ${ luminanceFn }( color );
				let resolution = textureDimensions( ${ mapNode } );

				return ${ equirectLuminancePdfFn }( lum, ${ totalSumNode }, resolution );

			}
		`;

	}

}
