import {
	MeshBasicMaterial,
	RenderTarget,
	NoToneMapping,
	QuadMesh,
	NoBlending,
	Color,
	Vector4,
} from 'three/webgpu';

const MAX_TEXTURE_SIZE = 4096;
const _prevClearColor = new Color();

function getTextureHash( texture ) {

	return `${ texture.source.uuid }:${ texture.source.version }`;

}

// TODO: consider adding a "waste map"
// TODO: consider using "best fit"

// Skyline rectangle packing (bottom-left, no waste map).
// A "skyline" is an array of contiguous segments { x, y, width } that always
// spans [ 0, pageWidth ] and describes the upper contour of placed rectangles.
// Each rect is placed where its top edge is lowest ( leftmost on ties ).
//
// Reference: Jukka Jylänki, "A Thousand Ways to Pack the Bin - A Practical
// Approach to Two-Dimensional Rectangle Bin Packing" (2010), the Skyline
// Bottom-Left (SkylineBL) heuristic. See also Sean Barrett's stb_rect_pack.h:
// https://github.com/nothings/stb/blob/master/stb_rect_pack.h

// Resting y for a w-wide rect whose left edge sits at nodes[ i ].x. The rect
// bridges every segment it spans and rests on the tallest of them. Returns -1
// if it would run off the right edge.
function skylineFit( nodes, i, w, pageWidth ) {

	const x = nodes[ i ].x;
	if ( x + w > pageWidth ) {

		return - 1;

	}

	let widthLeft = w;
	let y = 0;
	let j = i;
	while ( widthLeft > 0 ) {

		// defensive: the skyline should always cover the full page width
		if ( j >= nodes.length ) {

			return - 1;

		}

		y = Math.max( y, nodes[ j ].y );
		widthLeft -= nodes[ j ].width;
		j ++;

	}

	return y;

}

// Patch the skyline after placing a rect spanning [ x, x + w ] with top edge y.
// The left edge x always aligns to an existing segment boundary, so only the
// right edge can split a segment. Mutates nodes in place.
function addSkylineNode( nodes, x, y, w ) {

	const right = x + w;
	const result = [];
	let inserted = false;

	for ( let i = 0; i < nodes.length; i ++ ) {

		const node = nodes[ i ];
		const nodeRight = node.x + node.width;

		if ( nodeRight <= x ) {

			// entirely left of the new node
			result.push( node );

		} else if ( node.x >= right ) {

			// entirely right of the new node
			if ( ! inserted ) {

				result.push( { x, y, width: w } );
				inserted = true;

			}

			result.push( node );

		} else {

			// overlapped by the new node
			if ( ! inserted ) {

				result.push( { x, y, width: w } );
				inserted = true;

			}

			// keep any right-side remainder at its original height
			if ( nodeRight > right ) {

				result.push( { x: right, y: node.y, width: nodeRight - right } );

			}

		}

	}

	if ( ! inserted ) {

		result.push( { x, y, width: w } );

	}

	// merge adjacent segments of equal height and write back into nodes
	nodes.length = 0;
	for ( let i = 0; i < result.length; i ++ ) {

		const node = result[ i ];
		const last = nodes[ nodes.length - 1 ];
		if ( last && last.y === node.y && last.x + last.width === node.x ) {

			last.width += node.width;

		} else {

			nodes.push( node );

		}

	}

}

// Try to place a w x h rect into a single page's skyline. Returns the chosen
// { x, y } or null if it does not fit.
function skylineInsert( nodes, w, h, pageWidth, pageHeight ) {

	let bestY = Infinity;
	let bestX = 0;
	let bestIndex = - 1;

	for ( let i = 0; i < nodes.length; i ++ ) {

		const y = skylineFit( nodes, i, w, pageWidth );
		if ( y >= 0 && y + h <= pageHeight && y < bestY ) {

			bestY = y;
			bestX = nodes[ i ].x;
			bestIndex = i;

		}

	}

	if ( bestIndex === - 1 ) {

		return null;

	}

	addSkylineNode( nodes, bestX, bestY + h, w );
	return { x: bestX, y: bestY };

}

// Packs a set of textures into one or more atlas pages and exposes both the
// packed texture and a Uint32Array of per-texture info ( atlas bounds + page )
// suitable for upload as a uniform array.
export class AtlasTexture {

	get width() {

		return this.renderTarget.width;

	}

	get height() {

		return this.renderTarget.height;

	}

	get pageCount() {

		return this.renderTarget.depth;

	}

	get texture() {

		return this.renderTarget.texture;

	}

	constructor( options = {} ) {

		// RenderTarget already defaults to RGBA8, linear filtering, clamp wrapping
		// and no mipmaps, so we only specify the array-target-specific options here.
		this.renderTarget = new RenderTarget( 1, 1, {
			depthBuffer: false,
			depth: 1,
			...options,
		} );
		this.texture.isArrayTexture = true;

		// per-texture packed info ( one Vector4 each ): see _buildTextureInfo
		this.textureInfo = [ new Vector4() ];

		this.hashes = [];
		this.quadMesh = new QuadMesh( new MeshBasicMaterial() );
		this.quadMesh.material.blending = NoBlending;

	}

	setTextures( renderer, textures ) {

		// nothing to do if the set of textures is unchanged
		if ( this._hashesMatch( textures ) ) {

			return;

		}

		// same textures in a different order: keep the existing
		// placements and permute the per-index info to the new order
		// instead of repacking (and re-uploading) every texture
		if ( this._tryPermuteTextureInfo( textures ) ) {

			return;

		}

		// calculate the maximum dimension of the atlas
		let maxDim = textures.reduce( ( v, t ) => Math.max( v, t.width, t.height ), 1 );
		maxDim = Math.min( MAX_TEXTURE_SIZE, maxDim );

		const width = maxDim;
		const height = maxDim;

		// full repack of every texture
		const { renderTarget } = this;
		const { placements, pageCount } = this._packTextures( textures, width, height );

		// RenderTarget.setSize resets isArrayTexture to "image.depth > 1" so
		// we reset it here.
		renderTarget.setSize( width, height, pageCount );
		this.texture.isArrayTexture = true;

		this._buildTextureInfo( placements );
		this._renderTextures( renderer, textures, placements );

		// rebuild hashes and the texture -> index lookup
		const hashes = new Array( textures.length );
		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			const hash = getTextureHash( textures[ i ] );
			hashes[ i ] = hash;

		}

		this.hashes = hashes;

	}

	dispose() {

		this.renderTarget.dispose();
		this.quadMesh.material.dispose();

	}

	_hashesMatch( textures ) {

		const hashes = this.hashes;
		if ( hashes.length !== textures.length ) {

			return false;

		}

		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			if ( hashes[ i ] !== getTextureHash( textures[ i ] ) ) {

				return false;

			}

		}

		return true;

	}

	// Returns true (after rewriting this.hashes / this.textureInfo) when
	// `textures` is a permutation of the packed set, i.e. every hash in the
	// new order matches an unused hash of the packed one. Material traversal
	// order is not stable across edits that replace material instances, but
	// the texture *set* is — repacking those identical sources only re-blits
	// the same texels into the same rects.
	_tryPermuteTextureInfo( textures ) {

		const hashes = this.hashes;
		if ( hashes.length !== textures.length ) {

			return false;

		}

		const slotsByHash = new Map();
		for ( let i = 0, l = hashes.length; i < l; i ++ ) {

			const hash = hashes[ i ];
			if ( ! slotsByHash.has( hash ) ) {

				slotsByHash.set( hash, [] );

			}

			slotsByHash.get( hash ).push( i );

		}

		const newHashes = new Array( textures.length );
		const permutation = new Array( textures.length );
		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			const hash = getTextureHash( textures[ i ] );
			newHashes[ i ] = hash;

			const slots = slotsByHash.get( hash );
			if ( slots === undefined || slots.length === 0 ) {

				// a texture we have not packed — repack
				return false;

			}

			permutation[ i ] = slots.shift();

		}

		const previousInfo = this.textureInfo.slice();
		for ( let i = 0, l = permutation.length; i < l; i ++ ) {

			this.textureInfo[ i ] = previousInfo[ permutation[ i ] ];

		}

		this.hashes = newHashes;
		return true;

	}

	_packTextures( textures, width, height ) {

		// use each texture's native size, clamped so it can physically fit a page
		// ( anything larger is downsampled into its rect during the blit )
		const items = [];
		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			const texture = textures[ i ];
			items.push( {
				index: i,
				w: Math.min( texture.width, width ),
				h: Math.min( texture.height, height ),
			} );

		}

		// place taller rects first for tighter skyline occupancy
		const order = items.sort( ( a, b ) => b.h - a.h );

		const placements = new Array( textures.length );
		const pages = [];

		for ( let k = 0, l = order.length; k < l; k ++ ) {

			const item = order[ k ];
			let placed = null;
			let page = - 1;

			// try to fit into an existing page
			for ( let p = 0; p < pages.length; p ++ ) {

				placed = skylineInsert( pages[ p ], item.w, item.h, width, height );
				if ( placed ) {

					page = p;
					break;

				}

			}

			// otherwise open a new page
			if ( ! placed ) {

				const skyline = [ { x: 0, y: 0, width: width } ];
				placed = skylineInsert( skyline, item.w, item.h, width, height );
				pages.push( skyline );
				page = pages.length - 1;

			}

			placements[ item.index ] = { x: placed.x, y: placed.y, w: item.w, h: item.h, page };

		}

		return { placements, pageCount: Math.max( pages.length, 1 ) };

	}

	_buildTextureInfo( placements ) {

		const info = this.textureInfo;
		info.length = 0;
		for ( let i = 0, l = placements.length; i < l; i ++ ) {

			// offsetX and Y in pixels (16 bits + 16 bits)
			// width and height in pixels (16 bit + 16 bits)
			// page + reserved (16 bits)
			// reserved
			const { x, y, w, h, page } = placements[ i ];
			const v = new Vector4();
			v.x = ( x & 0xFFFF ) | ( ( y & 0xFFFF ) << 16 );
			v.y = ( w & 0xFFFF ) | ( ( h & 0xFFFF ) << 16 );
			v.z = page & 0xFFFF;
			v.w = 0;
			info.push( v );

		}

		if ( info.length === 0 ) {

			info.push( new Vector4( 0, 0, 0, 0 ) );

		}

	}

	_renderTextures( renderer, textures, placements ) {

		const { quadMesh, renderTarget, width, height } = this;

		// Save previous renderer state
		const prevRenderTarget = renderer.getRenderTarget();
		const prevToneMapping = renderer.toneMapping;
		const prevAutoClear = renderer.autoClear;
		const prevScissorTest = renderer.getScissorTest();
		const prevClearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( _prevClearColor );

		// blit each tile into its sub-rect without clearing the rest of the page
		renderer.toneMapping = NoToneMapping;
		renderer.autoClear = false;
		renderer.setScissorTest( true );
		renderer.setClearColor( 0, 0 );

		// clear the pages
		for ( let i = 0, l = renderTarget.depth; i < l; i ++ ) {

			renderTarget.viewport.set( 0, 0, width, height );
			renderTarget.scissor.set( 0, 0, width, height );
			renderer.setRenderTarget( renderTarget, i );
			renderer.clear();

		}

		// `texture.needsUpdate = true` on the clones below also bumps the
		// version of the *shared* source, and getTextureHash() hashes that
		// value. Save the versions so the blit does not invalidate the
		// hashes this atlas (or another atlas over the same sources) just
		// computed. WebGPU uploads are gated per texture.version, so the
		// clones still upload.
		const prevSourceVersions = new Array( textures.length );
		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			prevSourceVersions[ i ] = textures[ i ].source.version;

		}

		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			const { x, y, w, h, page } = placements[ i ];

			// Clone the source so we get an independent texture handle
			const texture = textures[ i ].clone();
			texture.matrixAutoUpdate = false;
			texture.matrix.identity();
			texture.needsUpdate = true;

			quadMesh.material.map = texture;

			// three.js uses the render target viewport / scissor
			renderTarget.viewport.set( x, y, w, h );
			renderTarget.scissor.set( x, y, w, h );
			renderer.setRenderTarget( renderTarget, page );
			quadMesh.render( renderer );

			texture.dispose();

		}

		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			textures[ i ].source.version = prevSourceVersions[ i ];

		}

		// restore the render target's full-size viewport/scissor and the renderer
		renderTarget.viewport.set( 0, 0, width, height );
		renderTarget.scissor.set( 0, 0, width, height );
		quadMesh.material.map = null;
		renderer.setClearColor( _prevClearColor, prevClearAlpha );
		renderer.setScissorTest( prevScissorTest );
		renderer.autoClear = prevAutoClear;
		renderer.setRenderTarget( prevRenderTarget );
		renderer.toneMapping = prevToneMapping;

	}

}
