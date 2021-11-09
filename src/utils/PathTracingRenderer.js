import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

function* renderTask() {

    const tw = this.tiles.x || 1;
    const ty = this.tiles.y || 1;
    while ( true ) {

        // TODO: jitter camera

        this.material.opacity = 1 / ( this.samples + 1 );

        for ( let x = 0; x < tw; x ++ ) {

            for ( let y = 0; y < ty; y ++ ) {

                // TODO: set camera offset

                // TODO: render

                // TODO: handle checker case?

                yield;

            }

        }

        this.samples ++;

    }

}

const ogClearColor = new Color();
export class PathTracingRenderer {

    get material() {

        return this._fsQuad.material;

    }

    set material( v ) {

        this._fsQuad.material = v;

    }

    constructor( renderer ) {

        this.tiles = new Vector2();
        this.target = new WebGLRenderTarget( 1, 1, {
            format: RGBAFormat,
            type: FloatType,
        } );
        this.samples = 0;
        this._renderer = renderer;
        this._fsQuad = new FullScreenQuad( null );
        this._task = null;

    }

    setSize( w, h ) {

        this.target.setSize( w, h );
        this.reset();

    }

    reset() {

        const renderer = this._renderer;
        const target = this.target;
        const ogRenderTarget = renderer.getRenderTarget();
        const ogClearAlpha = renderer.getClearAlpha();
        renderer.getClearColor( ogClearColor );

        renderer.setRenderTarget( target );
        renderer.setClearColor( 0, 0 );
        renderer.clearColor();

        renderer.setClearColor( ogClearColor, ogClearAlpha );
        renderer.setRenderTarget( ogRenderTarget );

        this.samples = 0;

    }

    update() {

        if ( ! this._task ) {

            this._task = renderTask.call( this );

        }

        this._task.next();

    }

}
