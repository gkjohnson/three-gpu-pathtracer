import { DataTexture, LinearFilter, Matrix4, RGBAFormat, RepeatWrapping } from 'three';
import { sampler, texture, uniform } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { equirectDirectionToUvFn, sampleHemisphereFn } from './nodes/sampling.wgsl.js';

export class EquirectBackgroundInfo {

	get map() {

		return this.mapNode.value;

	}

	set map( v ) {

		this.mapNode.value = v;

	}

	get blur() {

		return this.blurNode.value;

	}

	set blur( v ) {

		this.blurNode.value = v;

	}

	get rotation() {

		return this.rotationNode.value;

	}

	get intensity() {

		return this.intensityNode.value;

	}

	set intensity( v ) {

		this.intensityNode.value = v;

	}

	constructor() {

		const defaultMap = new DataTexture( new Uint8Array( [ 0, 0, 0, 255 ] ), 1, 1, RGBAFormat );
		defaultMap.minFilter = LinearFilter;
		defaultMap.magFilter = LinearFilter;
		defaultMap.wrapS = RepeatWrapping;
		defaultMap.wrapT = RepeatWrapping;
		defaultMap.generateMipmaps = false;
		defaultMap.needsUpdate = true;

		this.mapNode = texture( defaultMap );
		this.mapSampler = sampler( this.mapNode );
		this.blurNode = uniform( 0.0 );
		this.rotationNode = uniform( new Matrix4() );
		this.intensityNode = uniform( 1.0 );

		this._initFns();

	}

	dispose() {

		this.map.dispose();

	}

	_initFns() {

		const { mapNode, mapSampler, blurNode, rotationNode, intensityNode } = this;

		this.sampleColor = wgslTagFn/* wgsl */`
			fn sampleBackground( direction: vec3f, uv: vec2f ) -> vec4f {

				let rotatedDir = ( ${ rotationNode } * vec4f( direction, 0.0 ) ).xyz;
				let offsetDir = ${ sampleHemisphereFn }( rotatedDir, uv ) * 0.5 * ${ blurNode };
				let sampleDir = normalize( rotatedDir + offsetDir );

				let mapUv = ${ equirectDirectionToUvFn }( sampleDir );
				let col = textureSampleLevel( ${ mapNode }, ${ mapSampler }, mapUv, 0 );

				return vec4f( ${ intensityNode } * col.rgb, col.a );

			}
		`;

	}

}
