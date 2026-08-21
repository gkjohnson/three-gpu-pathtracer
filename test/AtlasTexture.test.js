import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Texture, Color } from 'three/webgpu';
import { AtlasTexture } from '../src/webgpu/AtlasTexture.js';

function makeTexture( width = 2, height = 2 ) {

	const texture = new Texture( { width, height, data: null } );
	texture.name = `tex-${ texture.uuid.slice( 0, 8 ) }`;
	return texture;

}

// minimal renderer double: _renderTextures only drives renderer state around
// the blit loop, the quad mesh render is stubbed separately per test
function makeFakeRenderer() {

	return {
		toneMapping: 0,
		autoClear: true,
		getRenderTarget: () => null,
		getScissorTest: () => false,
		getClearAlpha: () => 1,
		getClearColor: ( c ) => c.copy( new Color() ),
		setScissorTest: () => {},
		setClearColor: () => {},
		setRenderTarget: () => {},
		clear: () => {},
	};

}

function stubPackAndRender( atlas, placements ) {

	let repacks = 0;
	atlas._packTextures = () => {

		repacks ++;
		return { placements: placements.map( p => ( { ...p } ) ), pageCount: 1 };

	};

	atlas._renderTextures = () => {};

	return () => repacks;

}

test( 'reordered textures reuse placements instead of repacking', () => {

	const atlas = new AtlasTexture();
	const t1 = makeTexture();
	const t2 = makeTexture();
	const getRepacks = stubPackAndRender( atlas, [
		{ x: 0, y: 0, w: 2, h: 2, page: 0 },
		{ x: 2, y: 0, w: 2, h: 2, page: 0 },
	] );

	atlas.setTextures( makeFakeRenderer(), [ t1, t2 ] );
	assert.equal( getRepacks(), 1 );
	const infoAfterPack = atlas.textureInfo.slice();
	assert.notEqual( infoAfterPack[ 0 ], infoAfterPack[ 1 ] );

	// same two textures, swapped order: must not repack, must permute info
	atlas.setTextures( makeFakeRenderer(), [ t2, t1 ] );
	assert.equal( getRepacks(), 1, 'reordering must not repack' );
	assert.equal( atlas.textureInfo[ 0 ], infoAfterPack[ 1 ], 'info follows the texture' );
	assert.equal( atlas.textureInfo[ 1 ], infoAfterPack[ 0 ], 'info follows the texture' );

	// and a third call with the original order still early-outs via the
	// positional hash check
	atlas.setTextures( makeFakeRenderer(), [ t1, t2 ] );
	assert.equal( getRepacks(), 1 );
	assert.equal( atlas.textureInfo[ 0 ], infoAfterPack[ 0 ] );
	assert.equal( atlas.textureInfo[ 1 ], infoAfterPack[ 1 ] );

} );

test( 'a genuinely changed texture still repacks', () => {

	const atlas = new AtlasTexture();
	const t1 = makeTexture();
	const t2 = makeTexture();
	const getRepacks = stubPackAndRender( atlas, [
		{ x: 0, y: 0, w: 2, h: 2, page: 0 },
		{ x: 2, y: 0, w: 2, h: 2, page: 0 },
	] );

	atlas.setTextures( makeFakeRenderer(), [ t1, t2 ] );
	assert.equal( getRepacks(), 1 );

	// reordered but one source was genuinely edited (version bumped)
	t2.needsUpdate = true;
	atlas.setTextures( makeFakeRenderer(), [ t2, t1 ] );
	assert.equal( getRepacks(), 2, 'edited source must repack' );

	// a different texture set must repack too
	const t3 = makeTexture();
	atlas.setTextures( makeFakeRenderer(), [ t1, t3 ] );
	assert.equal( getRepacks(), 3 );

} );

test( 'blitting does not bump the shared source version', async () => {

	const atlas = new AtlasTexture();
	const t1 = makeTexture();
	const t2 = makeTexture();

	// real _renderTextures, stubbed quad render and fake renderer state
	atlas.quadMesh.render = () => {};

	let blits = 0;
	const originalRenderTextures = atlas._renderTextures.bind( atlas );
	atlas._renderTextures = ( ...args ) => {

		blits ++;
		return originalRenderTextures( ...args );

	};

	const placements = [
		{ x: 0, y: 0, w: 2, h: 2, page: 0 },
		{ x: 2, y: 0, w: 2, h: 2, page: 0 },
	];
	atlas._packTextures = () => ( { placements, pageCount: 1 } );

	const v1 = t1.source.version;
	const v2 = t2.source.version;
	atlas.setTextures( makeFakeRenderer(), [ t1, t2 ] );

	assert.equal( blits, 1 );
	assert.equal( t1.source.version, v1, 'shared source version must be preserved' );
	assert.equal( t2.source.version, v2, 'shared source version must be preserved' );

} );
