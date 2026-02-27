import { MeshBasicNodeMaterial, NoToneMapping, StorageTexture } from 'three/webgpu';
import { uv, varying, texture, vec4, toneMapping } from 'three/tsl';

// Material to apply tone mapping _before_ applying alpha blending
export class RenderToScreenNodeMaterial extends MeshBasicNodeMaterial {

	get texture() {

		return this._texNode.value;

	}

	set texture( v ) {

		this._texNode.value = v;

	}

	get toneMapping() {

		return this._toneMapping.toneMapping;

	}

	set toneMapping( v ) {

		this._toneMapping.setToneMapping( v );

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

		const toneMappingNode = toneMapping( NoToneMapping, 1.0, texNode );
		this._toneMapping = toneMappingNode;

		// apply alpha _after_ applying tone mapping
		this.transparent = true;
		this.colorNode = vec4( toneMappingNode.rgb.mul( toneMappingNode.a ), toneMappingNode.a );

		this.setValues( params );

	}

}
