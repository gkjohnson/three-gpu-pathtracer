import { FunctionNode, Node } from 'three/webgpu';

// minimal node that outputs a raw WGSL expression verbatim when built
class LiteralExpression extends Node {

	constructor( literal ) {

		super();
		this.literal = literal;

	}

	build() {

		return this.literal;

	}

}

// wraps a FunctionNode so that build() returns just the function name
class PropertyRefNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.build( builder, 'property' );

	}

}

// wraps a FunctionCallNode so that build() returns the inline call expression,
// bypassing TempNode's variable wrapping
class InlineCallNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.generate( builder );

	}

}

// returns the node that should be registered as an include for the given arg
function getIncludeNode( arg ) {

	if ( typeof arg === 'function' ) {

		if ( arg.functionNode ) return arg.functionNode;
		if ( arg.isStruct ) return arg.layout;
		return null;

	}

	if ( arg && arg.isNode ) {

		if ( arg.functionNode ) return arg.functionNode;
		if ( arg.isStructLayoutNode || arg.isCodeNode ) return arg;

	}

	return null;

}

export class WGSLTagFnNode extends FunctionNode {

	static get type() {

		return 'WGSLFnTagNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		// assemble all the nodes needed for includes
		const includes = [];
		for ( const arg of args ) {

			if ( Array.isArray( arg ) ) {

				for ( const element of arg ) {

					const node = getIncludeNode( element );
					if ( node ) includes.push( node );

				}

			} else {

				const node = getIncludeNode( arg );
				if ( node ) includes.push( node );

			}

		}

		// normalize args so generate function can resolve them with build() later:
		// - callable wrappers > PropertyRefNode (emits just the function name)
		// - struct callables > StructTypeNode (emits the type name via build)
		// - FunctionCallNodes > InlineCallNode (emits inline call)
		const normalizedArgs = args.map( arg => {

			if ( typeof arg === 'function' && arg.functionNode ) return new PropertyRefNode( arg.functionNode );
			if ( typeof arg === 'function' && arg.isStruct ) return arg.layout;
			if ( arg && arg.isNode && arg.functionNode ) return new InlineCallNode( arg );
			return arg;

		} );

		super( '', includes, lang );

		this.tokens = tokens;
		this.args = normalizedArgs;

	}

	// assemble the signature from tokens and arg names then parse
	getNodeFunction( builder ) {

		const { tokens, args } = this;
		const nodeData = builder.getDataFromNode( this );
		let nodeFunction = nodeData.nodeFunction;
		if ( nodeFunction === undefined ) {

			// reconstruct the full code with known names for struct args
			// and dummy identifiers for everything else
			let fullCode = '';
			for ( let i = 0, l = tokens.length; i < l; i ++ ) {

				fullCode += tokens[ i ];

				if ( i < args.length ) {

					const arg = args[ i ];
					if ( Array.isArray( arg ) ) {

						// include array — no text output

					} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

						// literals
						fullCode += String( arg );

					} else if ( arg.isStructLayoutNode ) {

						// struct type node
						fullCode += arg.getNodeType( builder );

					} else if ( arg.isStruct ) {

						// struct
						fullCode += arg.layout.getNodeType( builder );

					} else {

						fullCode += '_arg' + i;

					}

				}

			}

			// remove comments
			fullCode = fullCode.replace( /\/\/.+[\n\r]/g, '' );

			// parse it so we have the signature defined - we will define the body content after
			nodeFunction = builder.parser.parseFunction( fullCode );
			nodeData.nodeFunction = nodeFunction;

		}

		return nodeFunction;

	}

	// get the code for the function
	generate( builder, output ) {

		const { tokens, args } = this;

		// rebuild the function body again because we can call "build", now
		const result = super.generate( builder, output );
		let fullCode = '';
		for ( let i = 0, l = tokens.length; i < l; i ++ ) {

			fullCode += tokens[ i ];
			if ( i < args.length ) {

				const arg = args[ i ];
				if ( Array.isArray( arg ) ) {

					// include array — no text output

				} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

					fullCode += String( arg );

				} else {

					fullCode += arg.build( builder );

				}

			}

		}

		const { type } = this.getNodeFunction( builder );
		const nodeCode = builder.getCodeFromNode( this, type );

		fullCode = fullCode.replace( /\/\/.+[\n\r]/g, '' ).replace( /->\s*void/, '' ).replace( /\s+/g, ' ' ).trim();
		nodeCode.code = fullCode;

		return result;

	}

}

// template tag literal function version of "wgslFn" so easy interpolation of TSL nodes
// TODO: add a raw "wgsl" version for code snippets
export const wgslTagFn = ( tokens, ...args ) => {

	const functionNode = new WGSLTagFnNode( tokens, args );

	const fn = ( ...params ) => {

		// wrap string parameter values as raw WGSL expressions so they
		// output verbatim as identifiers like local variable names
		if ( params.length === 1 && params[ 0 ] && typeof params[ 0 ] === 'object' && ! params[ 0 ].isNode ) {

			const obj = params[ 0 ];
			for ( const key in obj ) {

				if ( typeof obj[ key ] === 'string' ) {

					obj[ key ] = new LiteralExpression( obj[ key ] );

				}

			}

		}

		return functionNode.call( ...params );

	};

	fn.functionNode = functionNode;

	return fn;

};
