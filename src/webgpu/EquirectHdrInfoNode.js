import { Matrix3 } from 'three/webgpu';
import { texture, sampler, uniform } from 'three/tsl';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { equirectDirectionToUvFn } from './nodes/sampling.wgsl.js';

export class EquirectHdrInfoNode extends EquirectHdrInfoUniform {

	constructor() {

		super();

		// environment map texture with its sampler
		this.mapNode = texture( this.map );
		this.mapSampler = sampler( this.map );

		// scalar parameters that assemble into the EnvironmentInfo struct in the shader
		this.rotationNode = uniform( new Matrix3() );
		this.intensityNode = uniform( 1 );

		this._initFns();

	}

	updateFrom( envMap ) {

		super.updateFrom( envMap );

		// refresh values in place on the existing nodes so no rebuild is required
		this.mapNode.value = this.map;
		this.mapSampler.value = this.map;

	}

	_initFns() {

		const {
			mapNode,
			mapSampler,
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

	}

}
