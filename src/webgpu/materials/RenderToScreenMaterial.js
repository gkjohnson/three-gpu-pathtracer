import { MeshBasicNodeMaterial, NoToneMapping, StorageTexture } from 'three/webgpu';
import { uv, varying, texture, vec4, toneMapping, uniform, wgslFn } from 'three/tsl';

// Material to apply tone mapping _before_ applying alpha blending
export class RenderToScreenNodeMaterial extends MeshBasicNodeMaterial {

	get texture() {

		return this._texNode.value;

	}

	set texture( v ) {

		this._texNode.value = v;

	}

	get fromTexture() {

		return this._fromTexNode.value;

	}

	set fromTexture( v ) {

		this._fromTexNode.value = v;

	}

	get toneMapping() {

		return this._toneMapping.toneMapping;

	}

	set toneMapping( v ) {

		this._toneMapping.setToneMapping( v );

	}

	get transition() {

		return this._transitionUniform.value;

	}

	set transition( v ) {

		this._transitionUniform.value = v;

	}

	get exposure() {

		return this._toneMapping.exposureNode.value;

	}

	set exposure( v ) {

		this._toneMapping.exposureNode.value = v;

	}

	constructor( params ) {

		super();

		const texNode = texture( new StorageTexture(), varying( uv() ) );
		this._texNode = texNode;

		const fromTexNode = texture( new StorageTexture(), varying( uv() ) );
		this._fromTexNode = fromTexNode;

		const transitionUniform = uniform( 1.0 );
		this._transitionUniform = transitionUniform;

		const fadedColor = wgslFn( /* wgsl */`
			fn fade( col0: vec4f, col1: vec4f, transition: f32 ) -> vec4f {

				return mix( col0, col1, transition );

			}
		` )( {
			col0: fromTexNode,
			col1: texNode,
			transition: transitionUniform,
		} );

		const toneMappingNode = toneMapping( NoToneMapping, 1.0, fadedColor );
		this._toneMapping = toneMappingNode;

		// apply alpha _after_ applying tone mapping
		// NOTE: alpha is being multiplied twice here to accommodate some odd blending in three.js
		// See mrdoob/three.js#33104. It's possible this should be removed or rethought once fixed.
		this.transparent = true;
		this.colorNode = vec4( toneMappingNode.rgb.mul( toneMappingNode.a ), toneMappingNode.a );

		this.setValues( params );

	}

}
