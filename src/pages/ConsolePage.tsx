import { useCallback, useEffect, useRef, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';
import CryptoJS from 'crypto-js';

import { Activity, ArrowDown, ArrowUp, LogOut, Mic, Zap, ZapOff } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';

import './ConsolePage.scss';
import Markdown from 'marked-react';

/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

const FETCH_TOOLS_HOST: string = process.env.REACT_APP_TOOLS_HOST || '';
const FETCH_TOOLS_AUTH_USERNAME: string = process.env.REACT_APP_AUTH_USERNAME || '';
const FETCH_TOOLS_AUTH_PASSWORD: string = process.env.REACT_APP_AUTH_PASSWORD || '';

/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: {
    [key: string]: any
  };
}


export function ConsolePage(props: {
  username?: string;
  logoutUrl?: string;
}) {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
    prompt('OpenAI API Key') ||
    '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
          apiKey: apiKey,
          dangerouslyAllowAPIKeyInBrowser: true
        }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * Utility for create base64 encode data
   */
  const b64encode = useCallback((data: any) => {
    return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(data));
  }, []);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder takes speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnecting(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect().then(async () => {
      setIsConnected(true);
      setIsConnecting(false);
      if (client.conversation.getItems().length == 0) {
        client.sendUserMessageContent([
          {
            type: `input_text`,
            text: `Hello!`
            // text: `For testing purposes, I want you to list ten car brands. Number each item, e.g. "one (or whatever number you are one): the item name".`
          }
        ]);
      }
      if (client.getTurnDetectionType() === 'server_vad') {
        await wavRecorder.record((data) => client.appendInputAudio(data.mono));
      }
    }).catch((reason) => {
      setIsConnecting(false);
      disconnectConversation()
      console.error(reason);
    });

  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * Get the function output
   */
  const fetchToolsOutput = useCallback(async (func: string, argument: Record<string, string> | undefined = undefined) => {
    const result = await fetch(`${FETCH_TOOLS_HOST}/tools/gpts/${func}?` + (new URLSearchParams(argument).toString()), {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(FETCH_TOOLS_AUTH_USERNAME + ':' + FETCH_TOOLS_AUTH_PASSWORD))
      }
    });
    return await result.json();
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      client.cancelResponse(trackId, offset);
    }
    if (wavRecorder.getStatus() != 'recording') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (wavRecorder.getStatus() != 'paused') {
      await wavRecorder.pause();
    }
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' }
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        'name': 'get_weather',
        'description': 'Get weather current and forecast report by the provide city name',
        'parameters': {
          'type': 'object',
          'properties': {
            'city_name': {
              'type': 'string',
              'description': 'The city name, like Beijing, New york'
            },
            'days': {
              'type': 'integer',
              'description': 'Number of days of weather forecast. Value ranges from 1 to 3, default value is 1.'
            }
          },
          'required': [
            'city_name'
          ]
        }
      },
      async ({ city_name, days = 3 }: {
        [key: string]: any
      }) => {
        return await fetchToolsOutput('get_weather', { city_name, days });
      }
    );
    client.addTool({
      'name': 'get_copper_price',
      'description': 'Get the real-time quotes for copper that are traded on exchanges around the world',
      'parameters': {
        'type': 'object',
        'properties': {},
        'required': []
      }
    }, async () => {
      return await fetchToolsOutput('get_copper_price');
    });
    client.addTool({
      'name': 'get_aluminum_price',
      'description': 'Get the real-time quotes for aluminum that are traded on exchanges around the world',
      'parameters': {
        'type': 'object',
        'properties': {},
        'required': []
      }
    }, async () => {
      return await fetchToolsOutput('get_aluminum_price');
    });
    client.addTool({
      'name': 'get_stock_price',
      'description': 'Get the latest bid and ask prices for a stock, as well as the volume and last trade price in real time.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_stock_price', { symbol });
    });
    client.addTool({
      'name': 'get_foreign_exchange_price',
      'description': 'Get the latest bid and ask prices for a currency pair',
      'parameters': {
        'type': 'object',
        'properties': {
          'currency_pair': {
            'type': 'string',
            'description': 'The currency pair, like USDAUD means USD and AUD'
          }
        },
        'required': [
          'currency_pair'
        ]
      }
    }, async ({ currency_pair }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_foreign_exchange_price', { currency_pair });
    });
    client.addTool({
      'name': 'get_discounted_cash_flow',
      'description': 'Calculate the DCF valuation for a company with advanced features like modeling multiple scenarios and using different valuation methods.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_discounted_cash_flow', { symbol });
    });
    client.addTool({
      'name': 'company_search',
      'description': 'Search over 70,000 symbols by symbol name or company name, including cryptocurrencies, forex, stocks, etf and other financial instruments.',
      'parameters': {
        'type': 'object',
        'properties': {
          'query': {
            'type': 'string',
            'description': 'The symbol name or company name, including cryptocurrencies, forex, stocks, etf and other financial instruments.'
          }
        },
        'required': [
          'query'
        ]
      }
    }, async ({ query }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('company_search', { query });
    });
    client.addTool({
      'name': 'get_stock_news_sentiments',
      'description': 'Get an RSS feed of the latest stock news articles with their sentiment analysis, including the headline, snippet, publication URL, ticker symbol, and sentiment score.',
      'parameters': {
        'type': 'object',
        'properties': {
          'page': {
            'type': 'number',
            'description': 'The page number'
          }
        },
        'required': []
      }
    }, async ({ page = 1 }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_stock_news_sentiments', { page });
    });
    client.addTool({
      'name': 'get_foreign_exchange_news',
      'description': 'Get a list of the latest forex news articles from a variety of sources, including the headline, snippet, and publication URL.',
      'parameters': {
        'type': 'object',
        'properties': {
          'page': {
            'type': 'number',
            'description': 'The page number'
          },
          'symbol': {
            'type': 'string',
            'description': 'The currency pair, like USDAUD means USD and AUD'
          }
        },
        'required': []
      }
    }, async ({ page = 1, symbol = '' }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_foreign_exchange_news', { page, symbol });
    });
    client.addTool({
      'name': 'get_company_key_metrics',
      'description': 'Get key financial metrics for a company, including revenue, net income, and price-to-earnings ratio (P/E ratio). Assess a company\'s financial performance and compare it to its competitors.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          },
          'period': {
            'type': 'string',
            'description': 'Like annual, quarter'
          },
          'limit': {
            'type': 'number',
            'description': 'The limit number'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol = '', period = '', limit = undefined }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_company_key_metrics', { symbol, period, limit });
    });
    client.addTool({
      'name': 'get_company_financial_ratios',
      'description': 'Get financial ratios for a company, such as the P/B ratio and the ROE. Assess a company\'s financial health and compare it to its competitors.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          },
          'period': {
            'type': 'string',
            'description': 'Like annual, quarter'
          },
          'limit': {
            'type': 'number',
            'description': 'The limit number'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol, period = '', limit = undefined }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_company_financial_ratios', { symbol, period, limit });
    });
    client.addTool({
      'name': 'get_company_cashflow_growth',
      'description': 'Get the cash flow growth rate for a company. Measure how quickly a company\'s cash flow is growing.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          },
          'period': {
            'type': 'string',
            'description': 'Like annual, quarter'
          },
          'limit': {
            'type': 'number',
            'description': 'The limit number'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol, period = '', limit = undefined }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_company_cashflow_growth', { symbol, period, limit });
    });
    client.addTool({
      'name': 'get_company_financial_score',
      'description': 'Get a financial score for a company, which is a measure of its overall financial health.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_company_financial_score', { symbol });
    });
    client.addTool({
      'name': 'get_company_rating',
      'description': 'The FMP Company Rating endpoint provides a rating of a company based on its financial statements, discounted cash flow analysis, financial ratios, and intrinsic value. Investors can use this rating to get a quick overview of a company\'s financial health and to compare different companies.',
      'parameters': {
        'type': 'object',
        'properties': {
          'symbol': {
            'type': 'string',
            'description': 'The company\'s stock symbol'
          }
        },
        'required': [
          'symbol'
        ]
      }
    }, async ({ symbol }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_company_rating', { symbol });
    });
    client.addTool({
      'name': 'get_fmp_articles',
      'description': 'Get a list of the latest articles from Financial Modeling Prep, including the headline, snippet, and publication URL.',
      'parameters': {
        'type': 'object',
        'properties': {
          'page': {
            'type': 'number',
            'description': 'The page number'
          },
          'size': {
            'type': 'number',
            'description': 'The article size of per page'
          }
        },
        'required': []
      }
    }, async () => {
      return await fetchToolsOutput('get_fmp_articles');
    });
    client.addTool({
      'name': 'get_general_news',
      'description': 'Get a list of the latest general news articles from a variety of sources, including the headline, snippet, and publication URL.',
      'parameters': {
        'type': 'object',
        'properties': {
          'page': {
            'type': 'number',
            'description': 'The page number'
          }
        },
        'required': []
      }
    }, async () => {
      return await fetchToolsOutput('get_general_news');
    });
    client.addTool({
      'name': 'get_stock_news',
      'description': 'Get a list of the latest stock news articles from a variety of sources, including the headline, snippet, publication URL, and ticker symbol.',
      'parameters': {
        'type': 'object',
        'properties': {
          'page': {
            'type': 'number',
            'description': 'The page number'
          },
          'tickers': {
            'type': 'string',
            'description': 'The stock\'s symbol, like AAPL,FB'
          },
          'limit': {
            'type': 'number',
            'description': 'The limit number'
          }
        },
        'required': []
      }
    }, async ({ page = 1, tickers = '', limit = undefined }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_stock_news', { page, tickers, limit });
    });
    client.addTool({
      'name': 'get_crypto_news',
      'description': 'Get a list of the latest crypto news articles from a variety of sources, including the headline, snippet, and publication URL. (Note: This endpoint requires the symbol in the format of BTCUSD to be passed in as a query parameter.)',
      'parameters': {
        'type': 'object',
        'properties': {
          'page': {
            'type': 'number',
            'description': 'The page number'
          },
          'symbol': {
            'type': 'string',
            'description': 'The crypto symbol, format is like BTCUSD'
          }
        },
        'required': []
      }
    }, async ({ page = 1, symbol = '' }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_crypto_news', { page, symbol });
    });
    client.addTool({
      'name': 'create_microsoft_authorization_url',
      'description': 'Create a Microsoft authorization link. After the user authorizes, the platform can help the user create calendar events, send emails, etc.',
      'parameters': {
        'type': 'object',
        'properties': {},
        'required': []
      }
    }, async () => {
      return await fetchToolsOutput('create_microsoft_authorization_url');
    });
    client.addTool({
      'name': 'get_outlook_calendar_events',
      'description': 'Get a list of event objects in the user\'s mailbox. The list contains single instance meetings and series masters.',
      'parameters': {
        'type': 'object',
        'properties': {
          'number_of_month': {
            'type': 'integer',
            'description': 'The number of months to query. For example, \'next two months\' represents a number of 2. The default value is 1'
          }
        },
        'additionalProperties': false,
        'required': [
          'number_of_month'
        ]
      }
    }, async ({ number_of_month = 3 }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('get_outlook_calendar_events', { number_of_month });
    });
    client.addTool({
      'name': 'create_outlook_calendar_event',
      'description': 'Create Outlook calendar events, such as scheduled meetings, planned trips, daily activities, etc. Users are required to provide the subject, description, location, start and end time of the event. The time provided by the user needs to be converted into the format of \'year-month-dayThour:minute:second\', for example, 2024-10-12T08:30:00, Please do not omit the separator \'T\' between the date and time.',
      'parameters': {
        'type': 'object',
        'properties': {
          'subject': {
            'type': 'string',
            'description': 'The event subject'
          },
          'description': {
            'type': 'string',
            'description': 'The event description'
          },
          'location': {
            'type': 'string',
            'description': 'The event location e.g. West District, NewYork City'
          },
          'start_time': {
            'type': 'string',
            'description': 'The event start time e.g. 2024-08-10T10:00:00'
          },
          'end_time': {
            'type': 'string',
            'description': 'The event end time e.g. 2024-08-10T15:30:00'
          },
          'attendees': {
            'type': 'array',
            'description': 'The attendees of the calendar event can be obtained from the user\'s contact list',
            'items': {
              'type': 'object',
              'properties': {
                'name': {
                  'type': 'string',
                  'description': 'The attendee\'s name'
                },
                'email': {
                  'type': 'string',
                  'description': 'The attendee\'s email address.'
                }
              }
            }
          }
        },
        'additionalProperties': false,
        'required': [
          'subject',
          'description',
          'location',
          'start_time',
          'end_time',
          'attendees'
        ]
      }
    }, async ({ subject, description, location, start_time, end_time, attendees }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('create_outlook_calendar_event', { subject, description, location, start_time, end_time, attendees });
    });
    client.addTool({
      'name': 'update_outlook_calendar_event',
      'description': 'Updates the properties of the event object. Users should provide the new subject, description, location, start or end time of the event. The time provided by the user needs to be converted into the format of \'year-month-dayThour:minute:second\', for example, 2024-10-12T08:30:00, Please do not omit the separator \'T\' between the date and time.',
      'parameters': {
        'type': 'object',
        'properties': {
          'event_id': {
            'type': 'string',
            'description': 'The event id'
          },
          'subject': {
            'type': 'string',
            'description': 'The event subject'
          },
          'description': {
            'type': 'string',
            'description': 'The event description'
          },
          'location': {
            'type': 'string',
            'description': 'The event location e.g. West District, NewYork City'
          },
          'start_time': {
            'type': 'string',
            'description': 'The event start time e.g. 2024-08-10T10:00:00'
          },
          'end_time': {
            'type': 'string',
            'description': 'The event end time e.g. 2024-08-10T15:30:00'
          },
          'attendees': {
            'type': 'array',
            'description': 'The attendees of the calendar event can be obtained from the user\'s contact list',
            'items': {
              'type': 'object',
              'properties': {
                'name': {
                  'type': 'string',
                  'description': 'The attendee\'s name'
                },
                'email': {
                  'type': 'string',
                  'description': 'The attendee\'s email address.'
                }
              }
            }
          }
        },
        'required': [
          'event_id'
        ]
      }
    }, async ({ event_id, subject = '', description = '', location = '', start_time = '', end_time = '', attendees = '' }: {
      [key: string]: any
    }) => {
      return await fetchToolsOutput('update_outlook_calendar_event', { event_id, subject, description, location, start_time, end_time, attendees });
    });
    client.addTool({
        'name': 'delete_outlook_calendar_event',
        'description': 'Delete the event object.',
        'parameters': {
          'type': 'object',
          'properties': {
            'event_id': {
              'type': 'string',
              'description': 'The event id'
            }
          },
          'additionalProperties': false,
          'required': [
            'event_id'
          ]
        }
      }
      , async ({ event_id }: {
        [key: string]: any
      }) => {
        return await fetchToolsOutput('delete_outlook_calendar_event', { event_id });
      });

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        item.formatted.file = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   */
  return (
    <div data-component='ConsolePage'>
      <div className='content-top'>
        <div className='content-title'>
          <img src='https://realtime.wonderbyte.ai/flaskr/static/icon.svg' alt={'wonder byte logo'} />
          <span>Wonder Byte Realtime</span>
        </div>
        <div className='content-api-key'>
          <span>Hello, {props.username}</span><span className={'spacer'}>|</span><a
          href={props.logoutUrl}>Logout</a><LogOut />
        </div>
      </div>
      <div className='content-main'>
        <div className='content-logs'>
          <div className='content-block events'>

            <div className='content-block-title'>events</div>
            <div className='content-block-body' ref={eventsScrollRef}>
              {!realtimeEvents.length && `awaiting start connection...`}
              {realtimeEvents.map((realtimeEvent, i) => {
                const count = realtimeEvent.count;
                const event = { ...realtimeEvent.event };
                if (event.type === 'input_audio_buffer.append') {
                  event.audio = `[trimmed: ${event.audio.length} bytes]`;
                } else if (event.type === 'response.audio.delta') {
                  event.delta = `[trimmed: ${event.delta.length} bytes]`;
                }
                return (
                  <div className='event' key={event.event_id}>
                    <div className='event-timestamp'>
                      {formatTime(realtimeEvent.time)}
                    </div>
                    <div className='event-details'>
                      <div
                        className='event-summary'
                        onClick={() => {
                          // toggle event details
                          const id = event.event_id;
                          const expanded = { ...expandedEvents };
                          if (expanded[id]) {
                            delete expanded[id];
                          } else {
                            expanded[id] = true;
                          }
                          setExpandedEvents(expanded);
                        }}
                      >
                        <div
                          className={`event-source ${
                            event.type === 'error'
                              ? 'error'
                              : realtimeEvent.source
                          }`}
                        >
                          {realtimeEvent.source === 'client' ? (
                            <ArrowUp />
                          ) : (
                            <ArrowDown />
                          )}
                          <span>
                            {event.type === 'error'
                              ? 'error!'
                              : realtimeEvent.source}
                          </span>
                        </div>
                        <div className='event-type'>
                          {event.type}
                          {count && ` (${count})`}
                        </div>
                      </div>
                      {!!expandedEvents[event.event_id] && (
                        <div className='event-payload'>
                          {JSON.stringify(event, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className='content-block conversation'>
            <div className='content-block-title'>conversation</div>
            <div className='content-block-body' data-conversation-content>
              {!isConnected && `awaiting start connection...`}
              {items.map((conversationItem, i) => {
                return (
                  <div className='row mb-3 gx-3 align-items-top row-message' key={conversationItem.id}
                       role={conversationItem.role ?? 'function'}>
                    <div
                      className='col-md-1 col-xs-12 text-md-center d-flex d-sm-block justify-content-between justify-content-sm-center align-items-center align-items-sm-start'>
                      {conversationItem.role == 'user' ?
                        <i className='bi bi-person fs-3 fw-bold' style={{ color: '#0099ff' }}></i> :
                        <i className='bi bi-robot fs-3 fw-bold' style={{ color: '#009900' }}></i>}
                    </div>
                    <div className='col p-3 bg-light markdown-content rounded'>
                      {/* tool response */}
                      {conversationItem.type === 'function_call_output' && (
                        <div className={'text-break'}>{conversationItem.formatted.output}</div>
                      )}
                      {/* tool call */}
                      {!!conversationItem.formatted.tool && (
                        <div className={'text-break lh-base'}>
                          {conversationItem.formatted.tool.name}(
                          {conversationItem.formatted.tool.arguments})
                        </div>
                      )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'user' && (
                          <div className={'text-break lh-base'}>
                            {conversationItem.formatted.transcript ||
                              (conversationItem.formatted.audio?.length
                                ? '(awaiting transcript)'
                                : conversationItem.formatted.text ||
                                '(item sent)')}
                          </div>
                        )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'assistant' && (
                          <div className={'text-break lh-base'}>
                            <Markdown>{conversationItem.formatted.transcript ||
                              conversationItem.formatted.text ||
                              '(truncated)'}</Markdown>
                          </div>
                        )}
                      {conversationItem.formatted.file && (
                        <audio
                          src={conversationItem.formatted.file.url}
                          controls
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className='content-actions user-select-none'>
            <div className='visualization'>
              <div className='visualization-entry client'>
                <canvas ref={clientCanvasRef} />
              </div>
              <div className='visualization-entry server'>
                <canvas ref={serverCanvasRef} />
              </div>
            </div>
            {
              isConnected && <>
                <Toggle
                  defaultValue={false}
                  labels={[<Mic />, <Activity />]}
                  values={['none', 'server_vad']}
                  tips={['Manual', 'Automatic']}
                  onChange={(_, value) => changeTurnEndType(value)}
                />
                <div className='spacer' />
                {canPushToTalk && (
                  <Button
                    title={isRecording ? 'release to send' : 'push to talk'}
                    label={<Mic />}
                    buttonStyle={isRecording ? 'alert' : 'regular'}
                    disabled={!isConnected || !canPushToTalk}
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                  />
                )}
                <div className='spacer' />
              </>
            }
            <Button
              label={isConnecting ? <><span className='spinner-border spinner-border-sm text-danger' role='status'
                                            aria-hidden='true'></span> Connecting...</> : (isConnected ? 'stop' : 'start')}
              iconPosition={isConnecting ? undefined : (isConnected ? 'start' : 'start')}
              icon={isConnecting ? undefined : (isConnected ? ZapOff : Zap)}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
              extraClass={!isConnected ? 'w-100 justify-content-center' : undefined}
              disabled={isConnecting}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
