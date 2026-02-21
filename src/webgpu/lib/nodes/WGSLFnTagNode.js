import { FunctionNode, Node } from 'three/webgpu';

// TODO: allow for glsl and wgsl version
// TODO: allow for structs
// TODO: allow for arbitrary includes (support array?)

// minimal node that outputs a raw WGSL expression verbatim when built,
// bypassing TSL's temp variable wrapping and type formatting
class RawExpression extends Node {

	constructor( code ) {

		super();
		this.code = code;

	}

	build() {

		return this.code;

	}

}

export class WGSLFnTagNode extends FunctionNode {

	static get type() {

		return 'WGSLFnTagNode';

	}

	constructor( tokens, args ) {

		// extract FunctionNode dependencies for includes — only function definitions
		// need to be pre-registered so their code appears before ours in the output.
		// callable wrappers and FunctionCallNodes are unwrapped to the underlying FunctionNode;
		// plain nodes (uniforms, storage, etc) are built inline in generate() and don't need includes.
		const includes = [];

		for ( const arg of args ) {

			if ( typeof arg === 'function' && arg.functionNode ) {

				includes.push( arg.functionNode );

			} else if ( arg && arg.isNode && arg.functionNode ) {

				includes.push( arg.functionNode );

			}

		}

		super( '', includes, 'wgsl' );

		this.tokens = tokens;
		this.args = args;

	}

	// parse the function signature from the static template parts (tokens[0] always
	// contains the full signature since interpolations only appear in the body)
	getNodeFunction( builder ) {

		const { tokens } = this;
		const nodeData = builder.getDataFromNode( this );
		let nodeFunction = nodeData.nodeFunction;
		if ( nodeFunction === undefined ) {

			const braceIndex = tokens[ 0 ].indexOf( '{' );
			const sig = braceIndex !== - 1
				? tokens[ 0 ].substring( 0, braceIndex )
				: tokens[ 0 ];

			nodeFunction = builder.parser.parseFunction( sig + ' {}' );
			nodeData.nodeFunction = nodeFunction;

		}

		return nodeFunction;

	}

	generate( builder, output ) {

		const { tokens, args } = this;

		// let FunctionNode.generate handle includes, code registration, property naming,
		// and type normalization (e.g. stripping "-> void" which is not valid WGSL)
		const result = super.generate( builder, output );

		// assemble the body by interleaving static tokens with resolved node names
		const parts = [];

		for ( let i = 0, l = tokens.length; i < l; i ++ ) {

			parts.push( tokens[ i ] );

			if ( i < args.length ) {

				const arg = args[ i ];
				if ( typeof arg === 'function' && arg.functionNode ) {

					// callable wrapper (from wgslFn/wgslFnTag) — resolve to function name
					parts.push( arg.functionNode.build( builder, 'property' ) );

				} else if ( arg.isNode && arg.functionNode ) {

					// FunctionCallNode — use generate() to get the inline call expression
					// (build() would wrap it in a temp variable that lives outside our WGSL scope)
					parts.push( arg.generate( builder ) );

				} else {

					parts.push( arg.build( builder ) );

				}

			}

		}

		const { type } = this.getNodeFunction( builder );
		const nodeCode = builder.getCodeFromNode( this, type );

		// use the declaration from super (handles type normalization and name assignment),
		// replace its empty body with the assembled body from the template
		const declaration = nodeCode.code;
		const declPrefix = declaration.substring( 0, declaration.indexOf( '{' ) + 1 );

		const assembledCode = parts.join( '' );
		const bodyStart = assembledCode.indexOf( '{' ) + 1;
		const bodyEnd = assembledCode.lastIndexOf( '}' );
		const body = assembledCode.substring( bodyStart, bodyEnd );

		nodeCode.code = declPrefix + body + '}\n';

		return result;

	}

}

const wgslFnTag = ( tokens, ...args ) => {

	const functionNode = new WGSLFnTagNode( tokens, args );

	const fn = ( ...params ) => {

		// wrap string parameter values as raw WGSL expressions
		// so they output verbatim as identifiers (e.g. local variable names)
		if ( params.length === 1 && params[ 0 ] && typeof params[ 0 ] === 'object' && ! params[ 0 ].isNode ) {

			const obj = params[ 0 ];
			for ( const key in obj ) {

				if ( typeof obj[ key ] === 'string' ) {

					obj[ key ] = new RawExpression( obj[ key ] );

				}

			}

		}

		return functionNode.call( ...params );

	};

	fn.functionNode = functionNode;

	return fn;

};

export {
	wgslFnTag,
};
