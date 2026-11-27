import { Node } from 'three/webgpu';
import { float, mx_heighttonormal, nodeObject, uv, vec2 } from 'three/tsl';

/**
 * The MaterialX "heighttonormal" node: the tangent space normal of a height, encoded like a normal map. three.js
 * derives it from screen space derivatives, which a path tracer has none of, so the path tracer reads the height
 * at neighboring texture coordinates instead. Rasterized, it renders as three.js' implementation.
 */
export class HeightToNormalNode extends Node {

	static get type() {

		return 'HeightToNormalNode';

	}

	constructor( heightNode, scaleNode, texcoordNode ) {

		super( 'vec3' );

		this.isHeightToNormalNode = true;
		this.heightNode = heightNode;
		this.scaleNode = scaleNode;
		this.texcoordNode = texcoordNode;

	}

	setup() {

		return mx_heighttonormal( this.heightNode, this.scaleNode, this.texcoordNode );

	}

}

export const heightToNormal = ( height, scale = 1, texcoord = uv() ) => {

	return nodeObject( new HeightToNormalNode( float( height ), float( scale ), vec2( texcoord ) ) );

};

// TODO: three.js builds "heighttonormal" from loose derivative nodes, leaving no node for the path tracer to
// substitute while it reads the graph. Remove this once it's a node of its own
/**
 * Replaces the "heighttonormal" and "bump" nodes of three.js' MaterialXLoader with ones the path tracer can
 * render. Pass "MtlXLibrary" from "three/examples/jsm/loaders/materialx/MaterialXNodeLibrary.js" before loading.
 *
 * @param {Object} library
 */
export function patchMaterialXLibrary( library ) {

	const normalMap = library.normalmap.nodeFunc;
	library.heighttonormal.nodeFunc = heightToNormal;
	library.bump.nodeFunc = ( height, scale = 1, ...frame ) => normalMap( heightToNormal( height, 1 ), scale, ...frame );

}
