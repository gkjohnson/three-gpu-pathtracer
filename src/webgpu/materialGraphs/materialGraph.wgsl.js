import { StructTypeNode, VaryingNode } from 'three/webgpu';
import { Fn, context, expression, overrideNodes, float, vec3, normalLocal, normalWorld, positionWorld } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

// TODO: three.js only inlines varyings in the fragment stage with "inlineVaryings", so a graph reading a varying like
// "positionLocal" in a compute shader emits an undeclared variable. Remove this once three.js applies the fragment
// stage's rules in the compute stage too, as below
const _varyingSetup = VaryingNode.prototype.setup;
VaryingNode.prototype.setup = function ( builder ) {

	if ( builder.context.inlineVaryings === true && builder.shaderStage === 'compute' ) {

		let node = this.node;
		while ( node.isSubBuildNode === true ) {

			node = node.node;

		}

		if ( node.isIndexNode !== true && ( node.isAttributeNode !== true || node.getContextAttribute( builder ) ) ) {

			return this.node;

		}

	}

	return _varyingSetup.call( this, builder );

};

// The values at the hit a graph reads. Each is passed to the graph as the geometry attribute "attribute", or in place
// of the TSL node "node", since a compute shader has no geometry or vertex stage to read them from
export const GRAPH_INPUTS = [
	{ name: 'uv', type: 'vec2', attribute: 'uv' },
	{ name: 'uv1', type: 'vec2', attribute: 'uv1' },
	{ name: 'positionLocal', type: 'vec3', attribute: 'position' },
	{ name: 'normalLocal', type: 'vec3', attribute: 'normal', node: normalLocal },
	{ name: 'color', type: 'vec4', attribute: 'color' },
	{ name: 'positionWorld', type: 'vec3', node: positionWorld },
	{ name: 'normalWorld', type: 'vec3', node: normalWorld },
];

// The surface inputs a graph can set: the node material's property, the field of the result it writes and its type
export const GRAPH_OUTPUTS = [
	{ key: 'colorNode', name: 'color', type: 'vec3' },
	{ key: 'opacityNode', name: 'opacity', type: 'float' },
	{ key: 'roughnessNode', name: 'roughness', type: 'float' },
	{ key: 'metalnessNode', name: 'metalness', type: 'float' },
	{ key: 'emissiveNode', name: 'emission', type: 'vec3' },
];

export const materialGraphInputStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_INPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphInput',
);

export const materialGraphResultStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_OUTPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphResult',
);

/**
 * Returns the WGSL function running the graphs of one material, writing the outputs it has graphs for to "result":
 * `fn runMaterialGraph( graph: i32, input: MaterialGraphInput, result: ptr<function, MaterialGraphResult> )`
 *
 * "graphs" holds each material's list of outputs, each a "GRAPH_OUTPUTS" entry with its graph's "node". Graph "i" is
 * the material at index "i". Each graph is built into its own function by three.js.
 *
 * @param {Array<Array<Object>>} graphs
 * @returns {Function}
 */
export function getRunMaterialGraphFn( graphs ) {

	const parts = [
		'fn runMaterialGraph( graph: i32, input: ', materialGraphInputStruct,
		', result: ptr<function, ', materialGraphResultStruct, '> ) -> void {\n\nswitch ( graph ) {\n\n',
	];

	graphs.forEach( ( outputs, graph ) => {

		parts.push( `case ${ graph }: {\n\n` );
		outputs.forEach( ( { name, type, node } ) => {

			parts.push( `result.${ name } = `, buildGraphCall( node, type, `materialGraph${ graph }_${ name }` ), ';\n' );

		} );
		parts.push( '\n}\n\n' );

	} );

	parts.push( 'default: {}\n\n}\n\n}\n' );
	return joinTagFn( parts );

}

// Returns a call of a TSL function evaluating "node" as "type" from the "input" struct, with the hit's values passed
// in through the node context
function buildGraphCall( node, type, name ) {

	const fn = Fn( ( params ) => {

		// the parameters are iterable but not indexable
		const values = [ ...params ];
		const inputs = {};
		GRAPH_INPUTS.forEach( ( input, i ) => inputs[ input.name ] = values[ i ] );

		const overrides = GRAPH_INPUTS.filter( input => input.node ).map( input => [ input.node, inputs[ input.name ] ] );
		const value = overrideNodes( overrides, type === 'float' ? float( node ) : vec3( node ) );
		return context( value, {
			getAttribute: attribute => {

				const input = GRAPH_INPUTS.find( input => input.attribute === attribute );
				return input ? inputs[ input.name ] : null;

			},
			inlineVaryings: true,
		} );

	} ).setLayout( {
		name,
		type,
		inputs: GRAPH_INPUTS.map( ( { name, type } ) => ( { name, type } ) ),
	} );

	return fn( ...GRAPH_INPUTS.map( ( { name, type } ) => expression( `input.${ name }`, type ) ) );

}

// joins code strings and nodes into a "wgslTagFn", for code with a varying number of nodes
function joinTagFn( parts ) {

	const tokens = [ '' ];
	const args = [];
	for ( const part of parts ) {

		if ( typeof part === 'string' ) {

			tokens[ tokens.length - 1 ] += part;

		} else {

			args.push( part );
			tokens.push( '' );

		}

	}

	return wgslTagFn( tokens, ...args );

}
